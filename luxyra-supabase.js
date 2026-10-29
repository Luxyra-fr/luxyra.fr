// ============================================================
// LUXYRA — MODULE SUPABASE (luxyra-supabase.js)
// ============================================================
// BUILD: 20260426-04 — fix CSS options dropdown lisibles
window.__LUXYRA_BUILD = "20260426-04";
// 2026-10-14 : version de la couche donnees, comparee par app.html (evite un melange ancienne/nouvelle version via le cache)
window.LX_DATA_VERSION = "20261029-3"; // 2026-10-29 (-3) : version affichée en bas de l'accueil. // 2026-10-29 (-9, 6.8.7 complément) : couche données inchangée, garde relevée avec app.html (libellé neutre de la colonne « bon cadeau » du registre CSV des factures, juste en franchise 293 B) ; 2026-10-29 (-9, Luxyra 6.8.7, lot 4b) : aucune modification de la couche données, garde relevée avec app.html (factures : lignes v2, bon à usage unique, remise de ligne) ; 2026-10-29 (-8 révisé, contre-audit : mentions légales rcs_ville / capital_social) ; 2026-10-28 (-8, Luxyra 6.8.6, lot 4) : saveTicketToDb enregistre toujours « paid » (annulation = contre-ticket), cancelTicketDb retirée, montants de la Z arrondis au centime à l'écriture. // 2026-10-28 (Luxyra 6.8.5, règle TVA unique : saveTicketToDb reprend la ventilation TVA figée par l'application (lxTvaFiger -> raw_data.lxTva, total_ht / total_tva / taux_tva), copie dans appointments.meta.lxTva ; Z ancienne sans taux mémorisé : taux déduit de ses montants scellés, jamais le taux actuel ; refus LX_Z_ECART_TVA traité comme un refus de Z). 2026-10-28 (-6, Luxyra 6.8.4 : couche de données inchangée hormis ce n° — accompagne app.html 6.8.4 ; vente reportée : la base exige en plus une journée de vente clôturée, une heure valide et la marque sur la 1re ligne, ce que _lxTicketReporter produit déjà). 2026-10-28 (-5, Luxyra 6.8.3 : date réelle d'une vente reportée scellée dans le ticket — items[0].lxRep —, clôture Z refusée par la base si des ventes du jour manquent au journal ou si une journée antérieure est retenue : refus permanent, journée rouverte, cause affichée) // 2026-10-28 (-4, Luxyra 6.8.2 : un ticket encaissé n'est JAMAIS abandonné par la file de secours — refus « journée déjà clôturée » = enregistrement de REPORT sur la journée ouverte (date réelle de vente en mention, raw_data.dateVente) ; clôture forcée = ticket consigné ET gardé en file ; Z de l'appareil : tickets reportés comptés le jour de leur enregistrement)
// (historique) "20261028-3"; // 2026-10-28 (-3, Luxyra 6.8.1 : version de l'application transmise dans chaque ticket (raw_data.lxVersion, contrôlée par le serveur), série de n° imprimés propre au serveur (meta.tkNumServeur), copies serveur jamais réécrites, refus LX_APP_OBSOLETE / LX_TKNUM_SERIE_SERVEUR / LX_CC_DEJA_EN_CAISSE)
// (historique) "20261028-2"; // 2026-10-28 (-2, Luxyra 6.8.0 : recettes en ligne enregistrées en caisse par le serveur — champs meta serveur / recetteKey…, refus définitif LX_CC_DEJA_EN_CAISSE)
// (historique) "20261028-1"; // 2026-10-28 (-1 : bons cadeaux à usage unique / multiple — qualification TVA du bon (usage_tva, qualif_tva, repli historique), ticket v2 HT/TVA par ventilation de l'app, taux_tva 0 pour une vente de BUM seule, bonsUtil conservé dans appointments.meta) ; 2026-10-27 (-3 : rapport du mois en vrai PDF + correctifs d’exports comptables, app.html seulement ; -2 : envoi au comptable — FEC + pack Excel + rapport par défaut, ZIP en option, app.html seulement ; -1 : envoi automatique au comptable — changement dans app.html seulement, couche données inchangée) ; 2026-10-17 (-2 : audit réglages — taux TVA produits brut (tvaProduitsColonne), familles produit sans produit (pcats), ancien saveSalonConfig renommé ; -1 : retour / remboursement partiel — champs du ticket de retour conservés dans appointments.meta, refus définitif LX_RETOUR_REFUSE jamais rejoué, ticket de retour refusé au rejeu écarté de la caisse) ; 2026-10-16 (-1 : incident Z n°128 — 1 réservation en ligne = 1 entrée, Z refusée par la base si différente du journal, annotations correctives) ; 2026-10-15 (-3 : multi-appareils, champs modifiés seulement + lignes supprimées ailleurs jamais recréées ; -2 : plus aucun enregistrement muet, lxEcritureVerifiee ; -1 : « Prix à partir de » + sur devis sur les forfaits) ; 2026-10-14 (-8 : correctifs revue d intégration) intégration des audits (données, sécurité, planning, clients, caisse, site, réglages)
// Ce fichier remplace le stockage en mémoire par Supabase.
// À inclure dans le HTML AVANT le code existant de l'app.
//
// USAGE :
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   <script src="luxyra-supabase.js"></script>
//   <script> ... code app existant ... </script>
//
// CONFIGURATION :
//   Remplace SUPABASE_URL et SUPABASE_ANON_KEY par tes valeurs
//   (trouvables dans Supabase Dashboard > Settings > API)
// ============================================================

// ===== CONFIGURATION =====
var SUPABASE_URL = "https://kxdgjtvrkwugbifgppai.supabase.co";
var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4ZGdqdHZya3d1Z2JpZmdwcGFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNDE2NTgsImV4cCI6MjA4ODYxNzY1OH0.J3jVuoHSWA0wXyaWxiRzILEWVNr8hbbgVYg73UEDTuI";

// ===== INIT SUPABASE CLIENT =====
var _sb = null;
if (typeof supabase !== "undefined" && supabase.createClient) {
  if (/[?&]vue_admin=/.test(location.search) && window._lxVraiLS) {
    // Vue admin : on utilise la session du PANNEAU ADMIN (support@luxyra.fr), jamais celle du salon
    // connecté sur ce navigateur. Seule la clé de session admin est lue/écrite dans le vrai stockage.
    var _lxCleAdmin = "sb-luxyra-admin-auth";
    var _lxStockAdmin = {
      getItem: function(k){ return String(k).indexOf(_lxCleAdmin) === 0 ? window._lxVraiLS.getItem(k) : null; },
      setItem: function(k, x){ if (String(k).indexOf(_lxCleAdmin) === 0) window._lxVraiLS.setItem(k, x); },
      removeItem: function(){ /* jamais : ne déconnecte pas le panneau admin */ }
    };
    // global.fetch renvoie vers window.fetch AU MOMENT de l'appel : supabase-js (base, RPC, fonctions serveur,
    // stockage) passe donc aussi par le filtre lecture seule posé plus bas (sinon il garde le fetch d'origine).
    _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { storageKey: _lxCleAdmin, storage: _lxStockAdmin, detectSessionInUrl: false }, global: { fetch: function(u, o){ return window.fetch(u, o); } } });
  } else {
    _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
}

// ===== VUE ADMIN EN LECTURE SEULE (2026-10-09) =====
// app.html?vue_admin=<salon_id> ouvert depuis le panneau admin (compte support@luxyra.fr) :
// l'app affiche les données du salon et TOUTE écriture est bloquée (base, fonctions, worker, stockage).
window._lxVueAdmin = (function(){ try{ var v=new URLSearchParams(location.search).get("vue_admin"); return /^[0-9a-f-]{36}$/i.test(v||"")?v:null; }catch(e){ return null; } })();
function _lxVueAdminStop(msg){
  if (!document.body) { document.addEventListener("DOMContentLoaded", function(){ _lxVueAdminStop(msg); }); return; }
  window._lxVueAdminArret = true;
  document.body.innerHTML = '<div style="padding:40px;font-family:sans-serif;color:#fff;background:#111;min-height:100vh"><h2>👁 Vue admin</h2><p>'+String(msg).replace(/</g,"&lt;")+'</p></div>';
}
if (window._lxVueAdmin && _sb) {
  (function(){
    // Jamais de déconnexion depuis la vue admin (elle couperait la session du panneau admin)
    try { _sb.auth.signOut = function(){ console.warn("[VUE ADMIN] déconnexion ignorée"); return Promise.resolve({ error: null }); }; } catch(_e) {}
    var refus = { data: null, error: { message: "Lecture seule (vue admin) : modification bloquée", code: "LX_LECTURE_SEULE" } };
    function bloque(){ var p = Promise.resolve(refus); var prox = new Proxy(function(){}, { get: function(t,k){ if(k==="then") return p.then.bind(p); if(k==="catch") return p.catch.bind(p); if(k==="finally") return p.finally.bind(p); return function(){ return prox; }; }, apply: function(){ return prox; } }); return prox; }
    var fromOrig = _sb.from.bind(_sb);
    _sb.from = function(t){ var q = fromOrig(t); ["insert","update","upsert","delete"].forEach(function(m){ q[m] = function(){ console.warn("[VUE ADMIN] écriture bloquée :", t, m); return bloque(); }; }); return q; };
    var rpcOrig = _sb.rpc.bind(_sb); var rpcLecture = { founders_stats:1, admin_find_duplicate_clients:1 };
    _sb.rpc = function(n, a, o){ if (rpcLecture[n]) return rpcOrig(n, a, o); console.warn("[VUE ADMIN] RPC bloquée :", n); return bloque(); };
    try { var stOrig = _sb.storage.from.bind(_sb.storage); _sb.storage.from = function(b){ var x = stOrig(b); ["upload","update","remove","move","copy"].forEach(function(m){ x[m] = function(){ return Promise.resolve(refus); }; }); return x; }; } catch(_e) {}
    var fetchOrig = window.fetch.bind(window); var lectureApi = { "/api/salon/availability":1, "/api/stripe/fees":1, "/api/siret":1 };
    window.fetch = function(u, o){
      try {
        var m = String((o && o.method) || (u && u.method) || "GET").toUpperCase();
        var url = new URL(typeof u === "string" ? u : (u && u.url) || "", location.href);
        var ecriture = m !== "GET" && m !== "HEAD" && m !== "OPTIONS";
        var sensible = (url.origin === location.origin && url.pathname.indexOf("/api/") === 0 && !lectureApi[url.pathname]) || /\/functions\/v1\//.test(url.pathname) || (/\/rest\/v1\//.test(url.pathname) && !/\/rest\/v1\/rpc\/(founders_stats|admin_find_duplicate_clients)$/.test(url.pathname)) || (/\/storage\/v1\//.test(url.pathname) && !/\/storage\/v1\/object\/(sign|list)\//.test(url.pathname));
        if (ecriture && sensible) { console.warn("[VUE ADMIN] requête bloquée :", m, url.pathname); return Promise.resolve(new Response(JSON.stringify({ error: "Lecture seule (vue admin)" }), { status: 403, headers: { "Content-Type": "application/json" } })); }
      } catch (_e) {}
      return fetchOrig(u, o);
    };
    document.addEventListener("DOMContentLoaded", function(){
      var b = document.createElement("div");
      b.id = "lxVueAdminBandeau";
      b.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:2147483000;background:#b71c1c;color:#fff;font:700 13px/1.4 system-ui,sans-serif;padding:8px 12px;text-align:center;box-shadow:0 -2px 12px rgba(0,0,0,.4)";
      b.textContent = "👁 VUE ADMIN — lecture seule : rien de ce que vous faites ici n'est enregistré";
      document.body.appendChild(b);
    });
  })();
}

// ===== STATE =====
var _salonId = null;       // UUID du salon connecté
var _userId = null;        // UUID auth de l'utilisateur
var _isOnline = false;     // true si connecté à Supabase
var _isSaving = false;     // évite les sauvegardes concurrentes
var _saveQueue = [];       // file d'attente des sauvegardes


// ============================================================
// CACHE INDEXEDDB — démarrage instantané (stale-while-revalidate)
// ============================================================
// Stratégie : au login, on lit le cache → hydrate les variables globales →
// affiche le dashboard immédiatement (~50ms). En parallèle, fetch full normal
// continue. À la fin du fetch, on remplace les data par les fraîches +
// re-render + sauve nouveau snapshot. Démarrage perçu <100ms même gros salon.
//
// Sécurité : isolation par salon_id, version du schema cache (purge auto si
// changement), feature flag (window.LX_CACHE_ENABLED), fallback automatique
// si IndexedDB échoue, clear au logout.
var LX_CACHE_DB_NAME = "luxyra_cache";
var LX_CACHE_VERSION = 1;
var LX_CACHE_SCHEMA_VERSION = 1; // bumper si on change la forme des snapshots
window.LX_CACHE_ENABLED = (typeof window.LX_CACHE_ENABLED === "undefined") ? true : window.LX_CACHE_ENABLED;
window._cacheHydrated = false; // true si on a hydraté depuis cache au démarrage
window._cacheRefreshing = false; // true pendant le fetch full background

function _hasIndexedDb(){
  try { return typeof indexedDB !== "undefined" && indexedDB; } catch(e){ return false; }
}

function _openCacheDb(){
  return new Promise(function(resolve, reject){
    if (!_hasIndexedDb()) return reject(new Error("no_indexeddb"));
    try {
      var req = indexedDB.open(LX_CACHE_DB_NAME, LX_CACHE_VERSION);
      req.onupgradeneeded = function(e){
        var db = e.target.result;
        if (!db.objectStoreNames.contains("snapshots")) {
          db.createObjectStore("snapshots", { keyPath: "salon_id" });
        }
      };
      req.onsuccess = function(e){ resolve(e.target.result); };
      req.onerror = function(e){ reject(e.target.error || new Error("idb_open_error")); };
    } catch(e){ reject(e); }
  });
}

async function readCacheSnapshot(salonId){
  if (!window.LX_CACHE_ENABLED || !salonId || !_hasIndexedDb()) return null;
  try {
    var db = await _openCacheDb();
    return new Promise(function(resolve){
      var tx, store, req;
      try {
        tx = db.transaction("snapshots", "readonly");
        store = tx.objectStore("snapshots");
        req = store.get(salonId);
      } catch(e){ resolve(null); return; }
      req.onsuccess = function(){
        var snap = req.result;
        // Validation : doit avoir la bonne version de schema, sinon on jette
        if (snap && snap.schema_version === LX_CACHE_SCHEMA_VERSION) resolve(snap);
        else resolve(null);
      };
      req.onerror = function(){ resolve(null); };
    });
  } catch(e){ console.warn("[cache] read failed:", e?.message || e); return null; }
}

async function writeCacheSnapshot(salonId, snapshot){
  if (!window.LX_CACHE_ENABLED || !salonId || !_hasIndexedDb()) return false;
  try {
    var db = await _openCacheDb();
    return new Promise(function(resolve){
      var tx, store, req;
      try {
        tx = db.transaction("snapshots", "readwrite");
        store = tx.objectStore("snapshots");
        snapshot.salon_id = salonId;
        snapshot.schema_version = LX_CACHE_SCHEMA_VERSION;
        snapshot.cached_at = new Date().toISOString();
        req = store.put(snapshot);
      } catch(e){ resolve(false); return; }
      req.onsuccess = function(){ resolve(true); };
      req.onerror = function(){ resolve(false); };
    });
  } catch(e){ console.warn("[cache] write failed:", e?.message || e); return false; }
}

async function clearCacheForSalon(salonId){
  if (!_hasIndexedDb()) return;
  try {
    var db = await _openCacheDb();
    var tx = db.transaction("snapshots", "readwrite");
    tx.objectStore("snapshots").delete(salonId);
  } catch(e){}
}

async function clearAllCache(){
  if (!_hasIndexedDb()) return;
  try {
    var db = await _openCacheDb();
    var tx = db.transaction("snapshots", "readwrite");
    tx.objectStore("snapshots").clear();
  } catch(e){}
}

// ============================================================================
// WAL (Write-Ahead Log) — Filet de sécurité 2026-05-15
// ============================================================================
// Persiste chaque action critique en LocalStorage AVANT le save DB. Si quelque
// chose plante après (bug JS, perte réseau, fermeture onglet), la donnée brute
// reste récupérable au prochain boot via _walCheck() → popup de récupération.
//
// Trigger : 15/05/2026 — Amandine a perdu 1 encaissement + 1 client + 1 RDV
// à cause d'un bug "ps is not defined" dans rAccounting (refactor _splitPrestProd
// af401bd du 13/05). L'action a planté avant d'atteindre saveXxxToDb.
// Avec ce WAL en place, la data aurait été préservée et récupérable.
// ============================================================================
var _WAL_KEY = "_lx_wal_v1";
var _WAL_MAX = 200;

// 2026-10-14 audit (NF525) : entrées qui ne sont JAMAIS évincées de la file tant qu'elles ne sont pas
// transmises : tickets, clôtures Z, et rendez-vous encaissés (ticket scellé).
function _walProtege(e){
  if (!e || e.synced) return false;
  if (e.type === "ticket" || e.type === "cloture") return true;
  if (e.type === "appointment" && e.data && (e.data.st === "done" || e.data.tkNum)) return true;
  return false;
}
// 2026-10-14 audit : éviction quand la file dépasse _WAL_MAX. Avant : slice(-200) jetait les plus anciennes
// entrées, transmises OU NON (un ticket non transmis pouvait disparaître). Désormais : d'abord les entrées déjà
// synchronisées, puis les plus anciennes entrées non protégées ; les entrées protégées ne sont jamais évincées
// (la file peut alors dépasser _WAL_MAX).
function _walEvincer(wal, max){
  if (!Array.isArray(wal) || wal.length <= max) return wal;
  var trop = wal.length - max, out = [], i;
  for (i = 0; i < wal.length; i++) { if (trop > 0 && wal[i] && wal[i].synced && !wal[i].abandonne) { trop--; continue; } out.push(wal[i]); }
  if (trop <= 0) return out;
  var out2 = [], perdus = [];
  for (i = 0; i < out.length; i++) {
    if (trop > 0 && !_walProtege(out[i])) { trop--; perdus.push(out[i]); continue; }
    out2.push(out[i]);
  }
  if (perdus.length) {
    try { console.warn("[WAL] éviction de " + perdus.length + " entrée(s) non transmise(s) (file pleine)"); } catch(_) {}
    try { if (typeof saveAuditEntry === "function") saveAuditEntry("DB_ERROR", JSON.stringify({ fn: "_walEvincer", msg: "File de secours pleine : entrées non transmises évincées", entrees: perdus.map(function(p){ return { type: p.type, ts: p.ts, id: p.data && p.data.id }; }).slice(0, 20) }).slice(0, 2000)); } catch(_) {}
  }
  return out2;
}
function _walPersist(type, data, extra){
  try {
    var wal = JSON.parse(localStorage.getItem(_WAL_KEY)||"[]");
    var entry = {
      id: "wal_" + Date.now() + "_" + Math.random().toString(36).slice(2,8),
      type: type,
      data: data,
      salon_id: _salonId,
      ts: new Date().toISOString(),
      synced: false,
      mode_caisse: window.LX_MODE_CAISSE || null // 2026-10-14 audit (NF525) : mode de caisse au moment de l'opération
    };
    // 2026-10-14 audit : base de fusion (_lxBase, non énumérable donc perdue à la sérialisation) conservée dans
    // l'entrée -> un rejeu n'écrit que ce qui a changé sur cet appareil au lieu d'écraser la fiche entière.
    if (extra && extra.base) entry.base = extra.base;
    wal.push(entry);
    wal = _walEvincer(wal, _WAL_MAX);
    var _json = JSON.stringify(wal);
    try { localStorage.setItem(_WAL_KEY, _json); }
    catch (eQ) {
      // 2026-10-14 audit : stockage plein -> on retire toutes les entrées déjà transmises et on réessaie une fois
      wal = wal.filter(function(e){ return !e.synced || e.abandonne; });
      try { localStorage.setItem(_WAL_KEY, JSON.stringify(wal)); }
      catch (eQ2) {
        // 2026-10-14 : JAMAIS silencieux — la copie de secours de cette opération n'a pas pu être écrite.
        console.error("[WAL] stockage plein, copie de secours impossible :", eQ2);
        try { if (typeof toast === "function") toast("Stockage de l’appareil plein : la copie de secours de cet enregistrement (" + type + ") n’a pas pu être conservée. Gardez la connexion active et libérez de l’espace (navigateur) ; contactez le support si le message se répète.", "error"); } catch(_t) {}
        try { if (typeof saveAuditEntry === "function") saveAuditEntry("DB_ERROR", JSON.stringify({ fn: "_walPersist", gravite: "critical", msg: "Stockage local plein : entrée de la file de secours non écrite", type: type, id: data && data.id, tk_num: data && data.tkNum }).slice(0, 2000)); } catch(_a) {}
        return null;
      }
    }
    return entry.id;
  } catch(e){
    console.warn("[WAL] persist failed:", e);
    try { if (typeof toast === "function") toast("La copie de secours de cet enregistrement n’a pas pu être conservée sur l’appareil : gardez la connexion active.", "error"); } catch(_t2) {}
    return null;
  }
}

function _walMarkSynced(walId){
  if (!walId) return;
  try {
    var wal = JSON.parse(localStorage.getItem(_WAL_KEY)||"[]");
    for (var i=0; i<wal.length; i++) {
      if (wal[i].id === walId) {
        wal[i].synced = true;
        wal[i].syncedAt = new Date().toISOString();
        localStorage.setItem(_WAL_KEY, JSON.stringify(wal));
        return;
      }
    }
  } catch(e){}
}

function _walCleanup(){
  try {
    var wal = JSON.parse(localStorage.getItem(_WAL_KEY)||"[]");
    var weekAgo = Date.now() - 7*24*3600*1000;
    var kept = wal.filter(function(e){
      if (!e.synced) return true;
      if (e.abandonne) return true; // 2026-10-14 (NF525) : ticket non transmis abandonné explicitement : conservé sur l'appareil
      var syncedTs = e.syncedAt ? new Date(e.syncedAt).getTime() : 0;
      return syncedTs > weekAgo;
    });
    if (kept.length !== wal.length) localStorage.setItem(_WAL_KEY, JSON.stringify(kept));
  } catch(e){}
}

async function _walCheck(){
  // 2026-10-14 audit : jamais de rejeu en mode archives / établissement suspendu, ni pendant un autre rejeu
  if (_lxEcrituresBloquees() || window._lxWalCheckEnCours) return;
  window._lxWalCheckEnCours = true;
  try { return await _walCheckUneFois(); } finally { window._lxWalCheckEnCours = false; }
}
async function _walCheckUneFois(){
  try {
    var wal = JSON.parse(localStorage.getItem(_WAL_KEY)||"[]");
    var unsynced = wal.filter(function(e){ return !e.synced && e.salon_id === _salonId; });
    if (unsynced.length === 0) { _walCleanup(); return; }
    console.warn("[WAL] " + unsynced.length + " action(s) non synchronisée(s) détectée(s) — récupération automatique");

    // FIX 2026-05-16 (UX) : récupération AUTOMATIQUE SILENCIEUSE en arrière-plan
    // Plus de modale anxiogène "voulez-vous sauvegarder ?" que l'utilisateur ne
    // comprend pas. Avec l'idempotence dans saveTicketToDb (check par hash) et
    // les protections dans saveCloture (codes 23505 + 42501), aucun risque de
    // doublon — la récupération est entièrement safe.
    //
    // Cas conservés en MODE MODALE (fallback) :
    //   - > 20 actions non-sync (crash grave / téléphone changé)
    //   - Échec récupération auto > 50% (problème réseau persistant)
    // 2026-10-11 (NF525, JET 70/125/120) : des opérations ont été conservées sur l'appareil faute de
    // connexion au serveur (mode dégradé) -> trace du mode dégradé puis de la centralisation.
    var _degTs = unsynced.map(function(e){ return e.ts || e.created_at || ""; }).filter(Boolean).sort()[0] || "";
    try { if (typeof saveAuditEntry === "function") saveAuditEntry("MODE_DEGRADE_DEBUT", unsynced.length + " opération(s) conservée(s) sur l'appareil, non transmise(s) au serveur" + (_degTs ? " (première : " + _degTs + ")" : "")); } catch(_eD){}
    var AUTO_THRESHOLD = 20;
    if (unsynced.length > AUTO_THRESHOLD) {
      console.warn("[WAL] Beaucoup d'actions non-sync ("+unsynced.length+") → modale de confirmation");
      if (typeof window.showWalRecovery === "function") window.showWalRecovery(unsynced);
      return;
    }

    // Récupération auto en arrière-plan
    var ok = 0, fail = 0, differe = 0;
    for (var i = 0; i < unsynced.length; i++) {
      try {
        var r = await _walResync(unsynced[i].id);
        // 2026-10-14 (NF525) : une entrée en attente (délai entre deux essais) n'est ni un succès ni un échec
        if (r && r.ok) { if (_walTransmiseVraiment(r)) ok++; } else if (r && r.differe) differe++; else if (r && r.abandon) {} /* tracé WAL_ABANDON */ else fail++;
      } catch(_) { fail++; }
    }
    if (differe) console.warn("[WAL] " + differe + " action(s) en attente d'un nouvel essai (délai entre deux essais)");

    try { if (typeof saveAuditEntry === "function") {
      saveAuditEntry("CENTRALISATION_DEGRADE", ok + " opération(s) transmise(s) au serveur après le mode dégradé" + (fail ? ", " + fail + " en attente" : ""));
      if (!fail && !differe) saveAuditEntry("MODE_DEGRADE_FIN", "Toutes les opérations conservées sur l'appareil sont centralisées");
    } } catch(_eC){}
    // Si trop d'échecs (>50%), on bascule sur la modale pour que l'utilisateur sache
    if (fail > 0 && fail >= (unsynced.length - differe) / 2) {
      console.warn("[WAL] " + fail + "/" + unsynced.length + " échecs → fallback modale");
      // Re-check les vraies non-sync restantes pour la modale
      var stillUnsynced = JSON.parse(localStorage.getItem(_WAL_KEY)||"[]")
        .filter(function(e){ return !e.synced && e.salon_id === _salonId; });
      if (stillUnsynced.length > 0 && typeof window.showWalRecovery === "function") {
        window.showWalRecovery(stillUnsynced);
      }
      return;
    }

    // Toast discret de succès SI il y a vraiment eu une récupération
    if (ok > 0) {
      console.log("[WAL] " + ok + " action(s) récupérée(s) automatiquement");
      // Toast non-bloquant côté UI (1 ligne, disparait après 4s)
      if (typeof toast === "function") {
        toast("✓ " + ok + " donnée" + (ok>1?"s":"") + " synchronisée" + (ok>1?"s":"") + " (récupération auto)", "success");
      } else if (typeof showAlert === "function") {
        showAlert("✓ " + ok + " donnée" + (ok>1?"s":"") + " synchronisée" + (ok>1?"s":""), "success");
      }
    }
  } catch(e){ console.warn("[WAL] check failed:", e); }
}

// 2026-10-14 (NF525) : un rejeu ÉCHOUÉ n'est plus marqué « synchronisé ».
// Avant : fn(entry.data) était appelé puis _walMarkSynced(walId) sans regarder le résultat
// (saveTicketToDb renvoie null sur erreur d'insertion, saveAppointment/saveCloture ne renvoyaient
// rien) -> un ticket refusé par le serveur sortait définitivement de la file de secours et
// n'était JAMAIS retransmis (perte d'un enregistrement de caisse). Désormais :
//   - succès confirmé (résultat sans .error et .ok !== false)      -> marqué synchronisé ;
//   - doublon permanent (code 23505, « existe déjà », déjà en base) -> marqué synchronisé (la donnée
//     est déjà en base ; sémantique inchangée, cf. FIX 2026-08-25 dans saveAppointment) ;
//   - autre échec -> l'entrée reste en file, compteur d'essais + attente croissante entre deux essais,
//     et après _WAL_ALERTE_ESSAIS échecs : alerte à l'opérateur (toast) + audit DB_ERROR, sans bloquer.
var _WAL_ALERTE_ESSAIS = 3;
// 2026-10-14 : échecs NON réseau comptés à part (echecsServeur) ; à _WAL_BLOQUE_ESSAIS l'entrée est marquée « bloque »
// (le serveur la refuse durablement) -> listée dans la fenêtre de refus de la Z avec « Signaler au support » et
// « Forcer la clôture » (lxWalForcerCloture). Elle reste rejouée tant qu'elle n'est pas abandonnée explicitement.
var _WAL_BLOQUE_ESSAIS = 10;
function _walNoterEssai(walId, okOuErreur, reseau){
  try {
    var wal = JSON.parse(localStorage.getItem(_WAL_KEY)||"[]");
    for (var i=0; i<wal.length; i++) {
      if (wal[i].id === walId) {
        wal[i].tries = (Number(wal[i].tries)||0) + 1;
        if (!reseau) {
          wal[i].echecsServeur = (Number(wal[i].echecsServeur)||0) + 1;
          if (wal[i].echecsServeur >= _WAL_BLOQUE_ESSAIS && !wal[i].bloque) { wal[i].bloque = true; wal[i].bloqueAt = new Date().toISOString(); }
        }
        wal[i].lastTryAt = new Date().toISOString();
        wal[i].lastError = okOuErreur ? String(okOuErreur).slice(0, 300) : null;
        localStorage.setItem(_WAL_KEY, JSON.stringify(wal));
        return wal[i];
      }
    }
  } catch(e){}
  return null;
}
function _walAttenteAvantEssai(entry){
  // attente = 1 min × 2^(essais-1), plafonnée à 60 min (1, 2, 4, 8, 16, 32, 60 min)
  var n = Number(entry && entry.tries) || 0;
  if (!n || !entry.lastTryAt) return 0;
  var att = Math.min(60, Math.pow(2, n - 1)) * 60 * 1000;
  var depuis = Date.now() - new Date(entry.lastTryAt).getTime();
  return Math.max(0, att - depuis);
}
function _walResultatOk(r){
  if (r === null || r === undefined || r === false) return false;
  if (typeof r !== "object") return !!r;
  if (r.error) return false;
  if (r.ok === false) return false;
  return true;
}
function _walResultatDoublonPermanent(r){
  try {
    if (!r || typeof r !== "object") return false;
    if (r.permanent === true) return true;
    var e = r.error;
    if (!e) return false;
    // 2026-10-28 (-3) : commande Click & Collect déjà en caisse (ticket serveur) : refus définitif, jamais rejoué
    return (e.code === "23505") || (String(e.message || "").indexOf("existe deja") >= 0) || (String(e.message || "").indexOf("existe déjà") >= 0) || (String(e.message || "").indexOf("LX_CC_DEJA_EN_CAISSE") >= 0);
  } catch(_) { return false; }
}
async function _walResync(walId, force){
  try {
    var wal = JSON.parse(localStorage.getItem(_WAL_KEY)||"[]");
    var entry = null;
    for (var i=0; i<wal.length; i++) { if (wal[i].id===walId) { entry=wal[i]; break; } }
    if (!entry || entry.synced) return { ok: false, reason: "introuvable ou déjà sync" };
    // 2026-10-14 audit (NF525) : une entrée d'un AUTRE établissement (autre compte ouvert avant sur cet appareil)
    // n'est jamais rejouée dans l'établissement courant (elle reste en file pour son établissement).
    if (!_salonId || entry.salon_id !== _salonId) return { ok: false, reason: "autre établissement", differe: true, autreSalon: true };
    // 2026-10-14 audit : mode archives / établissement suspendu / session perdue -> aucun rejeu
    if (_lxEcrituresBloquees()) return { ok: false, reason: "écritures bloquées (archives / suspendu)", differe: true };
    if (window._lxSessionPerdueActive) return { ok: false, reason: "session perdue", differe: true };
    if (!force) {
      var _att = _walAttenteAvantEssai(entry);
      if (_att > 0) return { ok: false, reason: "attente avant nouvel essai", differe: true };
    }
    // 2026-10-14 audit (NF525) : opération de caisse saisie en MODE TEST, alors que la caisse est passée en réel
    // depuis (les données de test ont été purgées par le serveur) -> jamais rejouée comme une opération réelle.
    var _scelleE = entry.type === "ticket" || entry.type === "cloture" || (entry.type === "appointment" && entry.data && (entry.data.st === "done" || entry.data.tkNum));
    if (_scelleE && entry.mode_caisse === "test" && window.LX_MODE_CAISSE === "reel") {
      try { if (typeof saveAuditEntry === "function") saveAuditEntry("WAL_ABANDON", JSON.stringify({ wal_id: walId, type: entry.type, raison: "opération saisie en mode test, caisse passée en réel depuis (données de test purgées)", tk_num: (entry.data && entry.data.tkNum) || null, tk_id: (entry.data && entry.data.id) || null, ts: entry.ts }).slice(0, 2000)); } catch (_eMT) {}
      _walMarkSynced(walId);
      return { ok: false, reason: "mode test", abandon: true };
    }
    // 2026-10-14 audit (NF525) : une clôture Z n'est jamais rejouée AVANT des tickets plus anciens non transmis
    if (entry.type === "cloture") {
      var _jourZ = entry.data && entry.data.date ? String(entry.data.date).slice(0, 10) : null;
      var _avant = wal.filter(function(e){
        if (!e || e.synced || e.id === entry.id || e.salon_id !== entry.salon_id) return false;
        var _tk = e.type === "ticket" || (e.type === "appointment" && e.data && (e.data.st === "done" || e.data.tkNum));
        if (!_tk) return false;
        if (e.horsZJusqua && _jourZ && _jourZ <= e.horsZJusqua) return false; // 2026-10-28 (-4) : ticket consigné par une clôture forcée (gardé en file, hors de cette Z)
        var _j = e.data && e.data.date ? String(e.data.date).slice(0, 10) : null;
        return (e.ts && entry.ts && e.ts <= entry.ts) || (_j && _jourZ && _j <= _jourZ);
      });
      if (_avant.length) return { ok: false, reason: _avant.length + " ticket(s) antérieur(s) non transmis : clôture rejouée après eux", differe: true };
    }
    // 2026-10-14 audit : rendez-vous supprimé (ici ou sur un autre appareil) -> jamais recréé par un rejeu
    if (entry.type === "appointment" && entry.data && entry.data.id && !(entry.data.st === "done" || entry.data.tkNum) && _lxRdvSupprime(entry.data.id)) {
      console.warn("[WAL] rejeu ignoré : rendez-vous supprimé", entry.data.id);
      _walMarkSynced(walId);
      return { ok: true, ignore: true };
    }
    // 2026-10-14 audit : rendez-vous modifié en base APRÈS cette opération (autre appareil) -> on n'écrase pas la
    // version plus récente (sauf encaissement pas encore en base, qui n'est jamais perdu). Colonne updated_at :
    // docs/migrations_1014/donnees.sql ; tant qu'elle n'existe pas, comportement inchangé.
    if (entry.type === "appointment" && entry.data && typeof entry.data.id === "string" && entry.data.id.length === 36 && !window._lxApptUpdAbsent) {
      try {
        var _srv = await _sb.from("appointments").select("id,updated_at,status,ticket_num").eq("id", entry.data.id).eq("salon_id", _salonId).maybeSingle();
        if (_srv && _srv.error && /updated_at/i.test(String(_srv.error.message || ""))) window._lxApptUpdAbsent = true;
        else if (_srv && !_srv.error && _srv.data && _srv.data.updated_at && entry.ts && new Date(_srv.data.updated_at).getTime() > new Date(entry.ts).getTime()) {
          var _encaisseLocal = (entry.data.st === "done" || entry.data.tkNum) && !(_srv.data.status === "done" || _srv.data.ticket_num);
          if (!_encaisseLocal) {
            console.warn("[WAL] rejeu ignoré : version en base plus récente", entry.data.id, _srv.data.updated_at, ">", entry.ts);
            try { if (typeof auditLog === "function") auditLog("CONFLIT_SYNCHRO", ("Rendez-vous " + entry.data.id + " (" + (entry.data.date || "") + " " + (entry.data.time || "") + ") : modification hors ligne du " + entry.ts + " non rejouée, version plus récente en base (" + _srv.data.updated_at + ")").slice(0, 1900)); } catch (_eCf) {}
            _walMarkSynced(walId);
            return { ok: true, ignore: true };
          }
        }
      } catch (_eUpd) {}
    }
    var fn = ({
      client: saveClient,
      appointment: saveAppointment,
      ticket: saveTicketToDb,
      cloture: saveCloture
    })[entry.type];
    if (!fn) return { ok: false, reason: "type non géré: " + entry.type };
    // 2026-10-14 audit : fiche client -> base de fusion reposée sur la copie, et contrôle « déjà transmise »
    // fait DANS la file de la fiche (une sauvegarde normale en cours aurait pu la transmettre entre-temps).
    if (entry.type === "client") {
      var _dataC = entry.data;
      if (_dataC && entry.base) _lxPoserBase(_dataC, entry.base);
      fn = function(d){ return _lxEnFile("c:" + ((d && d.id) || "nouveau"), function(){
        var _w = window._walGetAll(), _e = null;
        for (var q = 0; q < _w.length; q++) { if (_w[q].id === walId) { _e = _w[q]; break; } }
        if (!_e || _e.synced) return { ok: true, deja: true };
        var _pb = window._walBypass, _pp; window._walBypass = true;
        try { _pp = _saveClientUneFois(d); } finally { window._walBypass = _pb; } // lu de façon synchrone au début de la sauvegarde
        return _pp;
      }); };
    }
    // Bypass WAL pour éviter récursion (la 2ème save ne re-persiste pas)
    // 2026-10-14 audit : le drapeau n'est plus maintenu PENDANT l'attente réseau (il est lu de façon synchrone au
    // début de chaque sauvegarde) : avant, une sauvegarde normale faite pendant un rejeu n'était pas mise en file.
    var r, _pr;
    window._walBypass = true;
    try { _pr = fn(entry.data); } finally { window._walBypass = false; }
    r = await _pr;
    if (_walResultatOk(r)) {
      _walMarkSynced(walId);
      // 2026-10-14 audit : l'objet en mémoire (même identifiant) n'est plus marqué « non enregistré »
      try {
        var _lst = entry.type === "appointment" ? (typeof AP !== "undefined" ? AP : null) : (entry.type === "client" ? (typeof CL !== "undefined" ? CL : null) : null);
        if (_lst && entry.data && entry.data.id) for (var _q = 0; _q < _lst.length; _q++) { if (_lst[_q] && _lst[_q].id === entry.data.id) _lxMarquerEnregistre(_lst[_q]); }
      } catch (_eMk) {}
      return { ok: true, deja: !!(r && typeof r === "object" && r.deja) }; // deja : transmise entre-temps par une sauvegarde normale
    }
    if (_walResultatDoublonPermanent(r)) {
      // déjà en base : équivalent synchronisé (aucune perte, évite un rejeu à chaque démarrage)
      _walMarkSynced(walId);
      return { ok: true, doublon: true };
    }
    var _msg = (r && r.error && (r.error.message || r.error.code)) || (r && r.reason) || (entry.type === "ticket" && entry.data && entry.data._dbError && entry.data._dbError.msg) || "échec non confirmé par le serveur";
    // 2026-10-14 (NF525) : refus DÉFINITIFS (journée déjà clôturée, ticket scellé inaltérable) ou trop d'essais :
    // l'entrée sort de la file (sinon rejouée et signalée à chaque démarrage), avec une trace d'audit explicite.
    // 2026-10-28 (-4, v6.8.2, contre-audit BLOQUANT) : un TICKET n'est JAMAIS sorti de la file par cette règle. Refus « journée
    // déjà clôturée » : saveTicketToDb enregistre la vente sur la journée ouverte (report, date réelle de vente en mention) ; si
    // la journée du jour est elle aussi close, l'entrée attend le lendemain. Les refus réellement définitifs d'un ticket (retour
    // refusé, commande déjà en caisse) sont traités dans saveTicketToDb (la recette n'est pas perdue : déjà au journal / pas une
    // vente). Rendez-vous (copie de gestion, le ticket a sa propre entrée) : règle inchangée (inaltérable / retour refusé).
    var _definitif = entry.type === "appointment" && /d[eé]j[aà] cl[oô]tur[eé]e|inalt[eé]rable|LX_RETOUR_REFUSE/i.test(String(_msg)); // 2026-10-17 retour partiel : refus du garde-fou des retours = définitif
    var _e2 = _walNoterEssai(walId, _msg, _lxEstHorsLigne(_msg));
    var _rdvScelle = entry.type === "appointment" && entry.data && (entry.data.st === "done" || entry.data.tkNum); // 2026-10-14 : ticket encaissé = jamais abandonné pour erreur passagère
    if (_definitif || (entry.type === "appointment" && !_rdvScelle && _e2 && (Number(_e2.tries) || 0) >= 20)) { // un ticket ou une clôture Z n'est JAMAIS abandonné pour des erreurs passagères
      try { if (_definitif && typeof saveAuditEntry === "function") saveAuditEntry("DB_ERROR", JSON.stringify({ fn: "_walResync", gravite: "critical", msg: "Ticket refusé définitivement par le serveur (journée clôturée / inaltérable) : régularisation support nécessaire", type: entry.type, tk_num: (entry.data && entry.data.tkNum) || null, tk_id: (entry.data && entry.data.id) || null, data: entry.data }).slice(0, 4000)); } catch (_eC2) {}
      try { if (typeof saveAuditEntry === "function") saveAuditEntry("WAL_ABANDON", JSON.stringify({ wal_id: walId, type: entry.type, raison: _definitif ? "refus définitif du serveur" : "20 essais", msg: String(_msg).slice(0, 300), tk_num: (entry.data && entry.data.tkNum) || null, tk_id: (entry.data && entry.data.id) || null }).slice(0, 2000)); } catch (_eA) {}
      try { if (typeof toast === "function") toast("Un enregistrement (" + entry.type + ") a été refusé définitivement par le serveur : " + String(_msg).slice(0, 120) + ". Il est tracé dans le journal ; contactez le support si besoin.", "error"); } catch (_eT) {}
      _walMarkSynced(walId);
      return { ok: false, reason: _msg, abandon: true };
    }
    _walAlerterSiRepete(_e2, _msg);
    return { ok: false, reason: _msg };
  } catch(e){
    var _m3 = e && (e.message || String(e));
    var _e3 = _walNoterEssai(walId, _m3, _lxEstHorsLigne(e));
    _walAlerterSiRepete(_e3, _m3);
    return { ok: false, reason: _m3 };
  }
}
// 2026-10-14 : résultat de _walResync qui correspond à une VRAIE transmission (pour les compteurs affichés).
function _walTransmiseVraiment(r){ return !!(r && r.ok && !r.ignore && !r.doublon && !r.deja); }
// Alerte opérateur + audit après plusieurs échecs sur la MÊME entrée (une seule fois par entrée).
function _walAlerterSiRepete(entry, msg){
  try {
    if (!entry || (Number(entry.tries)||0) < _WAL_ALERTE_ESSAIS || entry.alerted) return;
    var wal = JSON.parse(localStorage.getItem(_WAL_KEY)||"[]");
    for (var i=0; i<wal.length; i++) { if (wal[i].id === entry.id) { wal[i].alerted = true; break; } }
    localStorage.setItem(_WAL_KEY, JSON.stringify(wal));
    var lib = ({client:"fiche client", appointment:"rendez-vous", ticket:"ticket de caisse", cloture:"clôture Z"})[entry.type] || entry.type;
    if (typeof toast === "function") toast("Un enregistrement (" + lib + ") n'a pas pu être transmis au serveur après " + entry.tries + " essais. Il reste conservé sur cet appareil et sera retransmis automatiquement : vérifiez la connexion.", "error");
    if (typeof saveAuditEntry === "function") {
      saveAuditEntry("DB_ERROR", JSON.stringify({
        fn: "_walResync", msg: "Rejeu échoué " + entry.tries + " fois : " + String(msg || "").slice(0, 300),
        wal_id: entry.id, type: entry.type, ts: entry.ts || null,
        tk_num: (entry.data && entry.data.tkNum) || null, tk_id: (entry.data && entry.data.id) || null
      }).slice(0, 2000));
    }
  } catch(_) {}
}

window._walResync = _walResync;
window._walCheck = _walCheck;
window._walGetAll = function(){ try { return JSON.parse(localStorage.getItem(_WAL_KEY)||"[]"); } catch(e){ return []; } };

// ============================================================================
// 2026-10-14 audit — ÉCRITURES BLOQUÉES, REJEU AUTOMATIQUE DE LA FILE, CLÔTURE Z, SUPPRESSIONS, SESSION
// ============================================================================
// Mode archives (lecture seule), établissement suspendu/résilié, vue admin : aucune sauvegarde ni aucun rejeu.
function _lxEcrituresBloquees(){
  return !!(window._archiveMode || window._lxSalonSuspendu || window._lxVueAdmin);
}
window._lxEcrituresBloquees = _lxEcrituresBloquees;

// Rejeu automatique de la file de secours : à la reconnexion réseau (« online »), au retour au premier plan et
// toutes les 2 minutes. Un seul rejeu à la fois (partagé avec _walCheck). Les entrées de moins de 45 s ne sont
// pas rejouées automatiquement (leur sauvegarde d'origine est peut-être encore en cours).
function lxWalRejouer(raison, force){
  if (window._lxWalCheckEnCours) return Promise.resolve({ ok: 0, enCours: true });
  if (!_sb || !_salonId || !_isOnline || window._lxDemo || _lxEcrituresBloquees() || window._lxSessionPerdueActive) return Promise.resolve({ ok: 0 });
  try { if (typeof navigator !== "undefined" && navigator.onLine === false) return Promise.resolve({ ok: 0, horsLigne: true }); } catch(_) {}
  window._lxWalCheckEnCours = true;
  return (async function(){
    var ok = 0, ko = 0, differe = 0;
    try {
      var maintenant = Date.now();
      var ids = window._walGetAll().filter(function(e){
        if (!e || e.synced || e.salon_id !== _salonId) return false;
        return force || (maintenant - new Date(e.ts || 0).getTime()) > 45000;
      }).map(function(e){ return e.id; });
      for (var i = 0; i < ids.length; i++) {
        var r = null;
        try { r = await _walResync(ids[i], !!force); } catch(_e) { r = null; }
        // 2026-10-14 : « transmis » = réellement envoyé au serveur par CE rejeu (pas les entrées ignorées : RDV supprimé,
        // version plus récente en base, déjà en base / doublon, déjà transmise entre-temps).
        if (r && r.ok) { if (_walTransmiseVraiment(r)) ok++; } else if (r && r.differe) differe++; else if (!(r && r.abandon)) ko++;
        if (window._lxSessionPerdueActive) break;
      }
      // 2026-10-14 : séances de forfait décomptées hors ligne / en échec réseau (file propre, app.html) — même déclencheur.
      try { if (typeof window._lxPacksRejouer === "function" && !window._lxSessionPerdueActive) await window._lxPacksRejouer(); } catch(_eP) { console.warn("[packs] rejeu", _eP); }
      if (ok) {
        console.log("[WAL] rejeu (" + (raison || "auto") + ") : " + ok + " enregistrement(s) transmis");
        try { if (typeof toast === "function") toast("✓ " + ok + " enregistrement" + (ok > 1 ? "s" : "") + " en attente transmis au serveur", "success"); } catch(_t) {}
      }
    } catch(e) { console.warn("[WAL] rejeu", e); }
    finally { window._lxWalCheckEnCours = false; }
    return { ok: ok, ko: ko, differe: differe };
  })();
}
window.lxWalRejouer = lxWalRejouer;
if (typeof window !== "undefined" && window.addEventListener) {
  window.addEventListener("online", function(){ setTimeout(function(){ lxWalRejouer("online"); }, 1500); });
  document.addEventListener("visibilitychange", function(){ if (document.visibilityState === "visible") setTimeout(function(){ lxWalRejouer("premier plan"); }, 2000); });
  setInterval(function(){ lxWalRejouer("periodique"); }, 2 * 60 * 1000);
}

// [NF525] Tickets (ou RDV encaissés) encore dans la file de secours pour cet établissement, jusqu'au jour donné inclus.
function lxWalTicketsNonTransmis(jour){
  return window._walGetAll().filter(function(e){
    if (!e || e.synced || e.salon_id !== _salonId) return false;
    var tk = e.type === "ticket" || (e.type === "appointment" && e.data && (e.data.st === "done" || e.data.tkNum));
    if (!tk) return false;
    // 2026-10-28 (-4) : ticket consigné par une clôture forcée de cette journée : toujours en file (transmis dès que possible,
    // reporté sur la journée ouverte si sa journée est close), mais ne bloque plus la Z de la journée déjà forcée
    if (jour && e.horsZJusqua && jour <= e.horsZJusqua) return false;
    var j = e.data && e.data.date ? String(e.data.date).slice(0, 10) : null;
    return !jour || !j || j <= jour;
  });
}
window.lxWalTicketsNonTransmis = lxWalTicketsNonTransmis;
// [NF525] La clôture Z est refusée tant que des tickets de la journée (ou antérieurs) ne sont pas transmis :
// la Z serait scellée sans eux. Message clair + bouton pour relancer la transmission. Renvoie true si bloquée.
function _lxWalEsc(v){ return String(v == null ? "" : v).replace(/[&<>"']/g, function(c){ return ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]; }); }
function _lxWalLibTicket(e){
  var d = e.data || {}, pr = Number(d.pr);
  return "Ticket #" + (d.tkNum || "?") + (d.date ? " du " + String(d.date).slice(0, 10).split("-").reverse().join("/") : "") +
    (isFinite(pr) ? " — " + pr.toFixed(2).replace(".", ",") + " €" : "") + (d.clientNom ? " — " + [d.clientPrenom, d.clientNom].filter(Boolean).join(" ") : "");
}
window.lxClotureBloqueeParWal = function(jour){
  try {
    var l = lxWalTicketsNonTransmis(jour);
    if (!l.length) return false;
    window._lxZWalJour = jour || null;
    var bloques = l.filter(function(e){ return e.bloque; });
    var m = document.getElementById("modal");
    var h = '<div class="mbg" onclick="cM()"><div class="mbox" onclick="event.stopPropagation()" style="text-align:center">' +
      '<div style="font-size:42px;margin-bottom:8px">⏳</div><h2>Clôture impossible pour le moment</h2>' +
      '<div style="font-size:14px;margin:10px 0 14px;line-height:1.5"><strong>' + l.length + ' ticket' + (l.length > 1 ? 's' : '') + '</strong> enregistré' + (l.length > 1 ? 's' : '') + ' sur cet appareil ' + (l.length > 1 ? "n'ont" : "n'a") + ' pas encore été transmis au serveur.<br>La clôture Z doit les inclure : transmettez-les d\'abord (vérifiez la connexion internet).</div>';
    if (bloques.length) {
      // 2026-10-14 : tickets refusés durablement par le serveur (≥ 10 échecs hors réseau) -> la Z ne doit pas rester
      // bloquée indéfiniment : liste claire, signalement au support, et clôture forcée consignée (jamais silencieuse).
      h += '<div style="text-align:left;background:var(--red-bg,rgba(220,53,69,.08));border:1px solid var(--red,#dc3545);border-radius:10px;padding:10px 12px;margin-bottom:12px;font-size:13px;line-height:1.45">' +
        '<div style="font-weight:700;margin-bottom:6px">' + bloques.length + ' ticket' + (bloques.length > 1 ? 's' : '') + ' refusé' + (bloques.length > 1 ? 's' : '') + ' par le serveur à chaque essai :</div><ul style="margin:0 0 0 18px;padding:0">';
      bloques.forEach(function(e){
        h += '<li style="margin-bottom:4px">' + _lxWalEsc(_lxWalLibTicket(e)) + '<br><span style="font-size:11px;color:var(--text3)">' + _lxWalEsc((e.echecsServeur || e.tries || 0) + " essais — " + String(e.lastError || "erreur inconnue").slice(0, 160)) + '</span></li>';
      });
      h += '</ul></div>' +
        '<button class="btn bk" id="lxZWalSupport" style="margin-bottom:8px" onclick="lxWalSignalerSupport()">Signaler au support</button>' +
        '<button class="btn bk" style="margin-bottom:8px;background:var(--red,#dc3545);color:#fff" onclick="lxWalForcerCloture()">Forcer la clôture (ticket non transmis consigné)</button>';
    }
    h += '<div id="lxZWalMsg" style="font-size:12px;color:var(--text3);margin-bottom:10px"></div>' +
      '<button class="btn bg bk" id="lxZWalBtn" onclick="lxWalRelancerPourCloture()">Réessayer la transmission</button>' +
      '<button class="btn bk" style="margin-top:8px" onclick="cM()">Fermer</button></div></div>';
    if (m) m.innerHTML = h; else if (typeof showAlert === "function") showAlert(l.length + " ticket(s) non transmis : clôture impossible pour le moment", "warning");
    return true;
  } catch(_e) { return false; }
};
// Signalement au support des tickets bloqués : journal (DB_ERROR critique -> alerte support) + server_errors.
window.lxWalSignalerSupport = async function(){
  var b = document.getElementById("lxZWalSupport"), msg = document.getElementById("lxZWalMsg");
  var bloques = lxWalTicketsNonTransmis(window._lxZWalJour || null).filter(function(e){ return e.bloque; });
  if (!bloques.length) return;
  if (b) { b.disabled = true; b.textContent = "Envoi au support…"; }
  var resume = bloques.map(function(e){ var d = e.data || {}; return { wal_id: e.id, type: e.type, ts: e.ts, tk_num: d.tkNum || null, tk_id: d.id || null, date: d.date || null, montant: d.pr, essais: e.echecsServeur || e.tries || 0, erreur: e.lastError || null }; });
  var ok1 = false, ok2 = false;
  try { if (typeof saveAuditEntry === "function") ok1 = await saveAuditEntry("DB_ERROR", JSON.stringify({ fn: "lxWalSignalerSupport", gravite: "critical", msg: "Tickets refusés durablement par le serveur : clôture Z bloquée, intervention support demandée", tickets: resume }).slice(0, 4000)); } catch(_a) {}
  try {
    if (_sb) { var r = await _sb.rpc("report_server_error", { p_source: "app_wal_bloque", p_message: bloques.length + " ticket(s) non transmis refusé(s) par le serveur — Z bloquée", p_severity: "error", p_context: { tickets: resume }, p_salon_id: _salonId || null }); ok2 = !!(r && !r.error); }
  } catch(_r) {}
  if (b) { b.disabled = false; b.textContent = (ok1 || ok2) ? "Signalé au support ✓" : "Signaler au support"; }
  if (ok1 || ok2) { try { if (typeof toast === "function") toast("Signalement envoyé au support Luxyra", "success"); } catch(_t) {} }
  else if (msg) msg.textContent = "Le signalement n'a pas pu être envoyé (connexion ?). Écrivez-nous depuis l'onglet Support.";
};
// Clôture forcée : chaque ticket bloqué est consigné INTÉGRALEMENT dans le journal (WAL_CONSIGNE, trace NF525) puis
// GARDÉ dans la file (2026-10-28 -4, v6.8.2 : plus jamais « abandonné ») : il ne bloque plus la Z de cette journée
// (horsZJusqua), il continue d'être transmis automatiquement et, sa journée étant close, il est enregistré sur la journée
// ouverte suivante avec la date réelle de vente en mention (saveTicketToDb). Sans trace écrite en base, rien n'est consigné.
window.lxWalForcerCloture = function(){
  var bloques = lxWalTicketsNonTransmis(window._lxZWalJour || null).filter(function(e){ return e.bloque; });
  if (!bloques.length) return;
  var txt = "Forcer la clôture sans " + (bloques.length > 1 ? "ces " + bloques.length + " tickets" : "ce ticket") + " ?\n\n" +
    bloques.map(_lxWalLibTicket).join("\n") +
    "\n\n" + (bloques.length > 1 ? "Ils ne seront pas inclus" : "Il ne sera pas inclus") + " dans cette clôture Z. Le contenu complet est consigné dans le journal des événements (trace NF525) et " + (bloques.length > 1 ? "ils restent" : "il reste") + " en attente sur cet appareil : dès que le serveur l'accepte, la vente est enregistrée sur la journée ouverte avec sa date réelle de vente (jamais perdue). Cette action est tracée à votre nom.";
  var go = async function(){
    var msg = document.getElementById("lxZWalMsg"), nOk = 0, nKo = 0;
    for (var i = 0; i < bloques.length; i++) {
      var e = bloques[i], d = Object.assign({}, e.data || {}); delete d.ticketHtml;
      var trace = { wal_id: e.id, type: e.type, raison: "clôture Z forcée : ticket refusé durablement par le serveur, GARDÉ en file (enregistré dès que le serveur l'accepte, sur la journée ouverte si sa journée est close)", jour_z: window._lxZWalJour || null, essais: e.echecsServeur || e.tries || 0, derniere_erreur: e.lastError || null, ts: e.ts, mode_caisse: e.mode_caisse || null, tk_num: d.tkNum || null, tk_id: d.id || null, data: d };
      var ok = false;
      try { if (typeof saveAuditEntry === "function") ok = await saveAuditEntry("WAL_CONSIGNE", JSON.stringify(trace)); } catch(_a) { ok = false; }
      if (!ok) { nKo++; continue; } // jamais consigné sans trace en base
      try {
        var wal = JSON.parse(localStorage.getItem(_WAL_KEY) || "[]"), now = new Date().toISOString(), jz = window._lxZWalJour || (d.date ? String(d.date).slice(0, 10) : null);
        for (var k = 0; k < wal.length; k++) { if (wal[k] && wal[k].id === e.id) { wal[k].horsZJusqua = (wal[k].horsZJusqua && jz && wal[k].horsZJusqua > jz) ? wal[k].horsZJusqua : jz; wal[k].consigneAt = now; wal[k].bloque = false; wal[k].echecsServeur = 0; break; } }
        localStorage.setItem(_WAL_KEY, JSON.stringify(wal));
        nOk++;
      } catch(_s) { nKo++; }
    }
    if (nKo) {
      try { window.lxClotureBloqueeParWal(window._lxZWalJour || null); } catch(_r0) {}
      msg = document.getElementById("lxZWalMsg");
      if (msg) msg.textContent = nKo + " ticket(s) n'ont pas pu être consignés dans le journal (connexion ?) : ils bloquent toujours la clôture.";
      try { if (typeof toast === "function") toast("Consignation impossible pour " + nKo + " ticket(s) : clôture toujours bloquée", "error"); } catch(_t) {}
      return;
    }
    try { if (typeof toast === "function") toast(nOk + " ticket(s) non transmis consigné(s) dans le journal et gardé(s) sur l'appareil : ils seront enregistrés automatiquement (journée suivante si besoin)", "warning"); } catch(_t2) {}
    try { if (typeof cM === "function") cM(); } catch(_c) {}
    if (!lxWalTicketsNonTransmis(window._lxZWalJour || null).length) { try { if (typeof doCloture === "function") doCloture(); } catch(_d) {} }
    else { try { window.lxClotureBloqueeParWal(window._lxZWalJour || null); } catch(_r) {} }
  };
  if (typeof showConfirm === "function") showConfirm(_lxWalEsc(txt), go); // texte échappé (noms de clients)
  else if (window.confirm(txt)) go();
};
window.lxWalRelancerPourCloture = async function(){
  var b = document.getElementById("lxZWalBtn"), msg = document.getElementById("lxZWalMsg");
  if (b) { b.disabled = true; b.textContent = "Transmission en cours…"; }
  try { await lxWalRejouer("cloture", true); } catch(_e) {}
  var reste = lxWalTicketsNonTransmis(null).length;
  if (!reste) {
    try { if (typeof toast === "function") toast("✓ Tickets transmis : vous pouvez clôturer", "success"); } catch(_t) {}
    try { if (typeof cM === "function") cM(); } catch(_c) {}
    try { if (typeof doCloture === "function") doCloture(); } catch(_d) {}
    return;
  }
  // 2026-10-14 : des tickets sont désormais marqués bloqués -> fenêtre réaffichée avec leur liste et les actions
  if (lxWalTicketsNonTransmis(window._lxZWalJour || null).some(function(e){ return e.bloque; })) { try { window.lxClotureBloqueeParWal(window._lxZWalJour || null); } catch(_r) {} msg = document.getElementById("lxZWalMsg"); }
  else if (b) { b.disabled = false; b.textContent = "Réessayer la transmission"; }
  if (msg) msg.textContent = reste + " ticket(s) toujours en attente. Vérifiez la connexion puis réessayez ; si le problème persiste, contactez le support.";
};

// Rendez-vous supprimés (ici ou sur un autre appareil) : jamais recréés par une sauvegarde ou un rejeu.
function _lxCleSupprimes(){ return "_lx_rdv_supprimes_" + (_salonId || ""); }
function _lxRdvSupprimes(){ try { return JSON.parse(localStorage.getItem(_lxCleSupprimes()) || "{}") || {}; } catch(_e) { return {}; } }
function _lxRdvSupprime(id){ if (!id || !_salonId) return false; return !!_lxRdvSupprimes()[id]; }
function lxRdvMarquerSupprime(id){
  if (!id || !_salonId) return;
  try {
    var s = _lxRdvSupprimes(); s[id] = Date.now();
    var ks = Object.keys(s);
    if (ks.length > 500) { ks.sort(function(a, b){ return s[a] - s[b]; }).slice(0, ks.length - 500).forEach(function(k){ delete s[k]; }); }
    localStorage.setItem(_lxCleSupprimes(), JSON.stringify(s));
  } catch(_e) {}
}
window.lxRdvMarquerSupprime = lxRdvMarquerSupprime;
window.lxRdvEstSupprime = _lxRdvSupprime;
// Identifiants de rendez-vous déjà vus en base (pour reconnaître une suppression faite sur un autre appareil)
window._lxApVusEnBase = window._lxApVusEnBase || {};
function _lxApVu(id){ if (id) window._lxApVusEnBase[id] = 1; }
// Suppression reçue en temps réel (autre appareil) : retirée de la mémoire, jamais recréée ici.
window.lxRdvSupprimeAilleurs = function(id){
  try {
    if (!id || typeof AP === "undefined" || !Array.isArray(AP)) return false;
    var retire = false;
    for (var i = AP.length - 1; i >= 0; i--) {
      var a = AP[i];
      if (!a || a.id !== id) continue;
      if (a.st === "done" || a.tkNum || a.hash) continue; // jamais un ticket (suppression impossible en base de toute façon)
      AP.splice(i, 1); retire = true;
    }
    if (retire) { lxRdvMarquerSupprime(id); console.log("[sync rdv] rendez-vous supprimé sur un autre appareil :", id); }
    return retire;
  } catch(_e) { return false; }
};
// Rafraîchissement (poll / temps réel / premier plan) : retire de la mémoire les rendez-vous supprimés en base
// (vus en base auparavant, absents maintenant, dans la fenêtre relue, jamais un ticket, pas d'envoi en attente).
// Ne fait rien si le résultat a pu être tronqué (1000 lignes = limite d'une requête).
window.lxApRetirerSupprimes = function(dbRows, depuis){
  try {
    if (!Array.isArray(dbRows) || typeof AP === "undefined" || !Array.isArray(AP)) return 0;
    var vus = window._lxApVusEnBase || {}, enBase = {}, attente = {}, n = 0;
    dbRows.forEach(function(a){ if (a && a.id) enBase[a.id] = 1; });
    window._walGetAll().forEach(function(e){ if (e && !e.synced && e.type === "appointment" && e.data && e.data.id) attente[e.data.id] = 1; });
    if (dbRows.length < 1000) {
      for (var i = AP.length - 1; i >= 0; i--) {
        var a = AP[i];
        if (!a || !a.id || enBase[a.id]) continue;
        if (a.st === "done" || a.tkNum || a.hash) continue;
        if (String(a.id).indexOf("online_") === 0) continue;
        var sup = _lxRdvSupprime(a.id);
        var disparu = vus[a.id] && a.date && (!depuis || a.date >= depuis) && !attente[a.id] && !a._lxNonEnregistre;
        if (sup || disparu) { AP.splice(i, 1); n++; }
      }
    }
    dbRows.forEach(function(a){ if (a && a.id) vus[a.id] = 1; });
    window._lxApVusEnBase = vus;
    if (n) console.warn("[sync rdv] " + n + " rendez-vous supprimé(s) en base retiré(s) de la mémoire");
    return n;
  } catch(_e) { return 0; }
};

// Enregistrement non abouti : message (au plus un toutes les 8 s) + marque sur l'objet (non énumérable).
var _lxDernierToastNonEnr = 0;
function _lxSignalerNonEnregistre(obj){
  try { if (obj && typeof obj === "object") Object.defineProperty(obj, "_lxNonEnregistre", { value: true, writable: true, configurable: true, enumerable: false }); } catch(_e) {}
  if (window._lxSessionPerdueActive) return;
  var n = Date.now(); if (n - _lxDernierToastNonEnr < 8000) return; _lxDernierToastNonEnr = n;
  try { if (typeof toast === "function") toast("Non enregistré — nouvelle tentative automatique", "warning"); } catch(_t) {}
}
function _lxMarquerEnregistre(obj){ try { if (obj && obj._lxNonEnregistre) obj._lxNonEnregistre = false; } catch(_e) {} }
// Une sauvegarde réussie de la fiche / du RDV X (état complet de cet appareil) rend caduques les entrées plus
// ANCIENNES de la file pour X : sans cela leur rejeu remettait une valeur périmée par-dessus la nouvelle.
function _walRendreCaduques(type, id, avantIso){
  if (!id || !avantIso || (type !== "client" && type !== "appointment")) return;
  try {
    var wal = JSON.parse(localStorage.getItem(_WAL_KEY) || "[]"), n = 0, now = new Date().toISOString();
    for (var i = 0; i < wal.length; i++) {
      var e = wal[i];
      if (!e || e.synced || e.type !== type || e.salon_id !== _salonId || !e.data || e.data.id !== id) continue;
      if (!(e.ts && e.ts < avantIso)) continue;
      if (type === "appointment" && _walProtege(e)) continue; // un encaissement n'est jamais rendu caduc
      e.synced = true; e.syncedAt = now; e.caduque = true; n++;
    }
    if (n) localStorage.setItem(_WAL_KEY, JSON.stringify(wal));
  } catch(_e) {}
}

// SESSION PERDUE (déconnexion sur un autre onglet, jeton expiré, rafraîchissement refusé) : fenêtre de
// reconnexion BLOQUANTE, SANS rechargement -> la mémoire et la file de secours sont conservées, puis reprise.
window._lxSessionPerdueActive = false;
function _lxErreurSession(err){
  try {
    if (!err) return false;
    var c = String(err.code || ""), m = String(err.message || err.msg || err || ""), st = Number(err.status) || 0;
    return st === 401 || c === "PGRST301" || c === "PGRST302" || c === "401" || /jwt|token.{0,20}(expired|invalid)|not authenticated|invalid claim|auth session missing|refresh token/i.test(m);
  } catch(_e) { return false; }
}
// Contrôle après un échec d'écriture (erreur d'authentification, refus RLS 42501, écriture « vide » 0 ligne) :
// session absente / expirée et non renouvelable -> fenêtre de reconnexion. Renvoie true si la session est perdue.
async function _lxControleSession(err, ecritureVide){
  try {
    if (window._lxSessionPerdueActive) return true;
    if (window._lxVueAdmin || window._lxDemo || !_sb || !_salonId) return false;
    var authErr = _lxErreurSession(err);
    if (!authErr && !ecritureVide && !(err && err.code === "42501")) return false;
    var s = null; try { s = (await _sb.auth.getSession()).data.session; } catch(_e) {}
    var expire = !!(s && s.expires_at && s.expires_at * 1000 < Date.now());
    if (s && (expire || authErr)) {
      try { var rr = await _sb.auth.refreshSession(); if (rr && rr.data && rr.data.session && !rr.error) return false; } catch(_e2) {}
      lxSessionPerdue("jeton refusé"); return true;
    }
    if (!s) { lxSessionPerdue("session absente"); return true; }
  } catch(_e3) {}
  return false;
}
window._lxControleSession = _lxControleSession;
function lxSessionPerdue(raison){
  if (window._lxSessionPerdueActive || window._lxVueAdmin || window._lxDemo || window._lxDeconnexionVolontaire) return;
  window._lxSessionPerdueActive = true;
  console.warn("[session] perdue :", raison);
  var afficher = function(){
    if (document.getElementById("lxSessionPerdue")) return;
    var d = document.createElement("div");
    d.id = "lxSessionPerdue";
    d.style.cssText = "position:fixed;inset:0;z-index:2147483600;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;font-family:var(--f1,sans-serif)";
    var inp = "width:100%;box-sizing:border-box;padding:12px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.08);color:#fff;font-size:15px;margin-bottom:10px";
    d.innerHTML = '<div style="background:#111;border:2px solid #c8a84e;border-radius:16px;padding:26px 22px;max-width:380px;width:90%;color:#fff">' +
      '<h3 style="margin:0 0 8px;color:#c8a84e;font-size:18px">Session expirée</h3>' +
      '<p style="font-size:13px;color:#ccc;margin:0 0 14px;line-height:1.5">Reconnectez-vous pour continuer. Rien n’est perdu : l’écran en cours et les enregistrements en attente sont conservés sur cet appareil et seront transmis après la reconnexion.</p>' +
      '<input id="lxSpEmail" type="email" autocomplete="username" placeholder="Email" style="' + inp + '">' +
      '<input id="lxSpPass" type="password" autocomplete="current-password" placeholder="Mot de passe" style="' + inp + '">' +
      '<div id="lxSpErr" style="display:none;color:#f87171;font-size:13px;margin-bottom:10px"></div>' +
      '<button id="lxSpBtn" style="width:100%;padding:13px;border-radius:10px;border:none;background:linear-gradient(135deg,#d4a843,#b8960f);color:#000;font-weight:800;font-size:15px;cursor:pointer">Se reconnecter</button>' +
      '<div style="text-align:center;margin-top:12px"><a href="#" id="lxSpQuitter" style="font-size:12px;color:#888">Se déconnecter complètement</a></div></div>';
    document.body.appendChild(d);
    var em = document.getElementById("lxSpEmail"); if (em) em.value = window._lxSessionEmail || "";
    var pw = document.getElementById("lxSpPass");
    if (pw) pw.addEventListener("keydown", function(ev){ if (ev.key === "Enter") _lxSessionReconnecter(); });
    document.getElementById("lxSpBtn").addEventListener("click", _lxSessionReconnecter);
    document.getElementById("lxSpQuitter").addEventListener("click", function(ev){ ev.preventDefault(); if (confirm("Se déconnecter ? Les enregistrements non transmis restent sur cet appareil.")) doLogout(); });
    try { (em && !em.value ? em : pw).focus(); } catch(_f) {}
  };
  if (document.body) afficher(); else document.addEventListener("DOMContentLoaded", afficher);
}
window.lxSessionPerdue = lxSessionPerdue;
async function _lxSessionReconnecter(){
  var err = document.getElementById("lxSpErr"), btn = document.getElementById("lxSpBtn");
  var em = (document.getElementById("lxSpEmail") || {}).value || "", pw = (document.getElementById("lxSpPass") || {}).value || "";
  var montrer = function(t){ if (err) { err.style.display = "block"; err.textContent = t; } };
  if (!em.trim() || !pw) { montrer("Saisissez l’email et le mot de passe."); return; }
  if (btn) { btn.disabled = true; btn.textContent = "Connexion…"; }
  try {
    var r = await _sb.auth.signInWithPassword({ email: em.trim(), password: pw });
    if (r.error || !r.data || !r.data.user) { montrer((r.error && r.error.message) || "Connexion impossible"); return; }
    if (_userId && r.data.user.id !== _userId) {
      // Cloisonnement : la mémoire contient les données d'un AUTRE compte -> pas de reprise, déconnexion propre
      montrer("Ce n’est pas le compte ouvert sur cet appareil. Déconnexion…");
      setTimeout(function(){ doLogout(); }, 1500);
      return;
    }
    window._lxSessionPerdueActive = false;
    window._lxSessionEmail = r.data.user.email || window._lxSessionEmail;
    try { if (typeof window.lxTouchSalonActivity === "function") window.lxTouchSalonActivity(); } catch(_a) {}
    var d = document.getElementById("lxSessionPerdue"); if (d) d.remove();
    try { if (typeof toast === "function") toast("✓ Reconnecté — reprise des enregistrements en attente", "success"); } catch(_t) {}
    setTimeout(function(){ lxWalRejouer("reconnexion", true); }, 500);
  } catch(e) { montrer((e && e.message) || "Connexion impossible"); }
  finally { if (btn) { btn.disabled = false; btn.textContent = "Se reconnecter"; } }
}
// Écoute des changements de session (déconnexion depuis un autre onglet, rafraîchissement du jeton refusé).
if (_sb && _sb.auth && typeof _sb.auth.onAuthStateChange === "function" && !window._lxVueAdmin) {
  try {
    _sb.auth.onAuthStateChange(function(event, session){
      try {
        if (session && session.user && session.user.email) window._lxSessionEmail = session.user.email;
        if (window._lxDeconnexionVolontaire || !_salonId) return; // déconnexion demandée / pas encore connecté
        if (event === "SIGNED_OUT" || (event === "TOKEN_REFRESHED" && !session)) {
          setTimeout(function(){ lxSessionPerdue(event === "SIGNED_OUT" ? "déconnecté" : "rafraîchissement refusé"); }, 0);
        }
      } catch(_e) {}
    });
  } catch(_eA) {}
}

// [NF525] Mode de caisse relu régulièrement (avant : lu seulement à la connexion). Un 2e appareil resté ouvert
// pendant le passage TEST -> réel fait sur un autre appareil le prend en compte ; comme les données de test ont été
// purgées par le serveur, l'application doit être rechargée (la file de secours est conservée).
async function lxRafraichirModeCaisse(){
  try {
    if (!_sb || !_salonId || window._lxDemo || window._lxVueAdmin || window._lxSessionPerdueActive) return;
    var r = await _sb.from("salons").select("mode_caisse").eq("id", _salonId).maybeSingle();
    if (!r || r.error || !r.data) return;
    var m = (r.data.mode_caisse === "test") ? "test" : "reel";
    var avant = window.LX_MODE_CAISSE;
    window.LX_MODE_CAISSE = m;
    if (avant === "test" && m === "reel" && !window._lxPassageReelIci && !document.getElementById("lxModeReelInfo")) {
      var d = document.createElement("div");
      d.id = "lxModeReelInfo";
      d.style.cssText = "position:fixed;inset:0;z-index:2147483500;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;font-family:var(--f1,sans-serif)";
      d.innerHTML = '<div style="background:#111;border:2px solid #c8a84e;border-radius:16px;padding:26px 22px;max-width:400px;width:90%;color:#fff;text-align:center">' +
        '<h3 style="margin:0 0 10px;color:#c8a84e">Caisse passée en mode réel</h3>' +
        '<p style="font-size:13px;color:#ccc;line-height:1.5;margin:0 0 16px">La caisse de l’établissement est désormais en mode réel (changement fait sur un autre appareil). Les encaissements de test ont été effacés : rechargez l’application pour continuer.</p>' +
        '<button onclick="location.reload()" style="padding:12px 22px;border-radius:10px;border:none;background:#c8a84e;color:#000;font-weight:800;cursor:pointer">Recharger</button></div>';
      document.body.appendChild(d);
    }
  } catch(_e) {}
}
window.lxRafraichirModeCaisse = lxRafraichirModeCaisse;
if (typeof window !== "undefined" && window.addEventListener) {
  setInterval(lxRafraichirModeCaisse, 5 * 60 * 1000);
  document.addEventListener("visibilitychange", function(){ if (document.visibilityState === "visible") lxRafraichirModeCaisse(); });
}

// Helper : retire les fonctions d'un objet (structuredClone d'IndexedDB ne les
// supporte pas). Utile pour SALON_CONFIG qui a des méthodes nomComplet/adresseComplete.
function _stripFunctions(obj){
  if (!obj || typeof obj !== "object") return obj;
  try {
    return JSON.parse(JSON.stringify(obj, function(k, v){
      return (typeof v === "function") ? undefined : v;
    }));
  } catch(e){ return null; }
}

// Sérialise l'état actuel des globales JS dans un objet snapshot.
// Capturé à la fin de loadSalonData(), restauré au prochain démarrage.
function _captureSnapshot(){
  var snap = {};
  // SALON_CONFIG : on retire les fonctions (nomComplet, adresseComplete, etc.)
  // qui sont définies au boot par app.html, pas besoin de les sérialiser.
  snap.SALON_CONFIG = (typeof SALON_CONFIG !== "undefined") ? _stripFunctions(SALON_CONFIG) : null;
  snap.T  = (typeof T  !== "undefined") ? T  : [];
  snap.SV = (typeof SV !== "undefined") ? SV : [];
  snap.PR = (typeof PR !== "undefined") ? PR : [];
  snap.CL = (typeof CL !== "undefined") ? CL : [];
  snap.AP = (typeof AP !== "undefined") ? AP : [];
  snap.PS = (typeof PS !== "undefined") ? PS : [];
  snap.CD = (typeof CAISSE_DATA !== "undefined") ? CAISSE_DATA : null;
  snap.FORFAITS = (typeof FORFAITS !== "undefined") ? FORFAITS : [];
  snap.GIFTS = (typeof GIFTS !== "undefined") ? GIFTS : [];
  snap.CLOTURES = window.CLOTURES || [];
  snap.AUDIT_LOG = window.AUDIT_LOG || [];
  snap.RDV_ONLINE = window.RDV_ONLINE || [];
  snap.PENDING_TK = window.PENDING_TK || [];
  snap.DEVIS = window.DEVIS || [];
  snap.TICKETS_DB = window.TICKETS_DB || [];
  snap.PACKS_CLIENTS = window.PACKS_CLIENTS || [];
  snap.SUPPLIERS = window.SUPPLIERS || [];
  return snap;
}

// Restaure l'état des globales depuis un snapshot. Doit être 100% idempotent.
function _hydrateFromSnapshot(snap){
  if (!snap) return false;
  try {
    if (snap.SALON_CONFIG && typeof SALON_CONFIG !== "undefined") {
      Object.assign(SALON_CONFIG, snap.SALON_CONFIG);
    }
    if (typeof window.T  === "object" || typeof T  !== "undefined") { window.T  = snap.T  || []; }
    if (typeof window.SV === "object" || typeof SV !== "undefined") { window.SV = snap.SV || []; }
    if (typeof window.PR === "object" || typeof PR !== "undefined") { window.PR = snap.PR || []; }
    if (typeof window.CL === "object" || typeof CL !== "undefined") { window.CL = snap.CL || []; }
    if (typeof window.AP === "object" || typeof AP !== "undefined") { window.AP = snap.AP || []; }
    if (typeof window.PS === "object" || typeof PS !== "undefined") { window.PS = snap.PS || []; }
    if (snap.CD) window.CAISSE_DATA = snap.CD;
    if (typeof window.FORFAITS === "object" || typeof FORFAITS !== "undefined") { window.FORFAITS = snap.FORFAITS || []; }
    if (typeof window.GIFTS === "object" || typeof GIFTS !== "undefined") { window.GIFTS = snap.GIFTS || []; }
    window.CLOTURES = snap.CLOTURES || [];
    window.AUDIT_LOG = snap.AUDIT_LOG || [];
    window.RDV_ONLINE = snap.RDV_ONLINE || [];
    window.PENDING_TK = snap.PENDING_TK || [];
    window.DEVIS = snap.DEVIS || [];
    window.TICKETS_DB = snap.TICKETS_DB || [];
    window.PACKS_CLIENTS = snap.PACKS_CLIENTS || [];
    window.SUPPLIERS = snap.SUPPLIERS || [];
    return true;
  } catch(e){ console.warn("[cache] hydrate failed:", e); return false; }
}

// Helpers exposés en global pour debug + clear depuis console
if (typeof window !== "undefined") {
  window.clearCacheForSalon = clearCacheForSalon;
  window.clearAllCache = clearAllCache;
  window._captureSnapshot = _captureSnapshot;
  window._hydrateFromSnapshot = _hydrateFromSnapshot;
}

// ============================================================
// AUTH — LOGIN / LOGOUT / SESSION
// ============================================================

// Afficher l'écran de login
function showLoginScreen() {
  var el = document.getElementById("app") || document.body;
  var bgEl=document.getElementById("appBg");if(bgEl){if(typeof APP_BG!=="undefined"&&APP_BG)bgEl.style.backgroundImage="url("+APP_BG+")";else bgEl.style.backgroundImage="url(https://images.unsplash.com/photo-1560066984-138dadb4c035?w=800&q=80)";bgEl.style.opacity="1";}
  var h = "";
  h += '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:var(--f1,sans-serif);position:relative">';
  h += '<div style="position:absolute;inset:0;background:rgba(0,0,0,.55);backdrop-filter:blur(4px)"></div>';
  h += '<div style="position:relative;z-index:1;background:rgba(10,10,20,.9);backdrop-filter:blur(20px);border:2px solid #c8a84e;border-radius:20px;padding:36px 28px;max-width:380px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,.5),0 0 40px rgba(200,168,78,.08)">';
  h += '<div style="text-align:center;margin-bottom:28px">';
  // Logo
  h += '<img src="data:image/webp;base64,UklGRnwGAABXRUJQVlA4IHAGAACQHACdASpQAFAAPlEkj0YjoiEhJ7K42HAKCWMAwNQX0lJGX9dqf0h7cnnufPA9JnqRN5p/0FcQ5co+5/UcQswPgNxe98J9H9QD8q/6L06/+j/G/3z9gPZx+c/4D/wf5n4Cf5Z/T/+j1vv2U///uS/sAox4qNxjc2z+QvJYwk5NKrN684SJhDRixrQd4vKFsupNSRdWFwicaUeld9wRx31xtRYP8s3VifiGEz/9lqIdwkIHDGojAkxFqdHr1Kdmu8IA/XDloqCzpVXxD2g1KIf92mGHu9GT0MNcFZV7vGZDxJo7miBihDdkE1SyuoAA/v+Pkc+qL9+cD/eqz7FtP5sZ8oBn+jBmPGZ/29zPJ7cdunBwbze4ovC0f0XEUJvkvdi5cjHhXiJAU57jXANWflaoxofRmdFVA4VOSMhDlaOeehzCmxbxQt9NDSMHJiGK0LvzOuVWkPLoOpBd01ShcY4V/mFX9D38zYPr71WXF7xRG2N8m1igrsQ8L2P6jqz1zy2rNJrlPqjY/y5kXi8N454YFsUYP9RZiz55PYPJ1on1kwhH4p++Aiax8sW/8w+JNjpT1M9O/4lDoQoVydyZz3RZEGdZV/9IPAov2+eh3jTBMNexxeiiVvi8ogcbG6t6OipvuNGgjy5ghXbAShOiipARUX8Cpn6xBN6CPWKPzLhdy5Jhm2ve5Ox44Gc27Kmjsg1r8ao2/WagPRf+v5HXxvFHaIxLL5n+hyDgpks3iQ74n08puz1ePtiXy23lUF7SHM/k6O4YPg71dSxCCeS9EyCNQOE+NE6xnRP9GwVGiRa26DfOaa8qTI815/oyhjuaVKoezi+5zzVtnNNheepey0JEOGcsRVc4pz/qEIPKmpWDibXHbfrnWnGK/5YSfNUd8tpk/MWPC/l/fs4TSZF9qxwlQgEBOJOiccajn2R4oIG0e2FUxYh1zSRUMwdDuGMXB+F9Zvt0gUi9a4UMxY8VGW5aZs+pPoWvgLg+m9L/zJSDo3Ety/UGWi5Zbkh/NoVyq7Iq+zR04vxyqUX1FkEjySqlMXgKal/mb1GA+SoLCz8qSdhZmJzQlrnL/3GML4DSgHEZiDwEPNBK539PkG+0nz5QGv8FbqK3cnnCZt+3aJI4GKz0zv3JRS+pwbYjVI9lMH4//xQuKXk/VISJ52eRiMujm7H3PZ3VG2nRubZjOc7Gdtj8fR3DhLjKmriQztuopTnZYJKtjU71eVGzTTcCs1pHLqpX65CXZrvCF/75fVVbKA8So7Km7PT1owWmwWbylHuavo5nzCFvYwtTIIUTNSfHUvGY0MccrWiGYbO4vwX6nN0w4HCxu37VXzbfSd+Fb6VC6tL1Rre4sncorImz+vf3YVXbmPx6wxAk2ijhHpCda1HDkAe8qF2mzNi+MfiAQTGoePTDQlhBfSTq5CcN4UXO6JYKfSxfQaLb4JJnleVCNTKasJgQGZQ5qSUYuzRbMj8s0KdKkoUwgWZ9Bhh4Du0BkBMwZ2fPlFOSyVP4QzgYFxDPinUQusFI/0y5u+iP465KnR0TWTIeOTzD4dfp8f8nesvn7+FBPiBLV5dY83GYU0rliH9z7sZMpSWOC2d/kMCuWiobtCrorySo0hv05UAvufqkfdFj0BfyfRYVnKJiuZeJtyOxTqTSDDYKpfQ/mDZse3eULjt4+SKvoAMbKDAhhujxXrDueuH1xnew37KvcMGf/Ldz/hPfv3propwUsUJHWJgmQbnb6gk0TJSn2If2hVox7z3h07W3heEfFRM4/Jlv1wGilNfgvBBkhwciu6JroZ9pgT/8Nfwpwj31+UB9H28f8GW/Nvqd9psdz02Q96/NZpSO2Uas6wGiXa8tgrP6bOb4p3WusHmbdbvpjh/5fjAa+Yv08pUJg/8ksGaLvUPKq+hKXsLjirZavtbmkmSiXtvSoXkllsE3ouU5C35+jqrsmWKw9uF7SzqTtA7HFsnXBRHBSS+tZOX0hbq6bofF4+jhCrVAsN/rFrF5BZQu5zlqQqdXEiriuqS21SD8waU7EGqzftGpRxo+b9MPPqzjH2YDwtCmnN91jYrCQEmyW052fvEnMLSG0aS4Da4y+ctx8dj2LPwbZ9aR4hO9J06Y1H5UrLCmQucA8ITk21V2ZH8/HLHfD/x2Al/MtGXlAinax9+4ZjhX9p7xOx6QhH6ghcy6DqH3OstJZVTDAAAA" style="width:80px;height:80px;border-radius:16px;margin-bottom:8px;box-shadow:0 4px 16px rgba(200,168,78,.2)" alt="L"><div style="font-size:28px;font-weight:900;color:var(--gold,#d4a843);font-family:Georgia,serif;letter-spacing:3px">Luxyra</div>';
  h += '<div style="font-size:13px;color:rgba(255,255,255,.5);margin-top:4px">Connectez-vous '+String.fromCharCode(224)+' votre espace</div></div>';
  h += '<div id="loginError" style="display:none;background:rgba(248,113,113,.15);color:#f87171;padding:10px;border-radius:10px;font-size:13px;margin-bottom:14px;text-align:center"></div>';
  h += '<div style="margin-bottom:14px"><label style="font-size:12px;color:rgba(255,255,255,.5);display:block;margin-bottom:5px;font-weight:600">Email</label>';
  h += '<input id="loginEmail" type="email" style="width:100%;padding:12px 16px;border-radius:12px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.08);color:#fff;font-size:15px;outline:none" placeholder="email@monactivite.fr"></div>';
  h += '<div style="margin-bottom:22px"><label style="font-size:12px;color:rgba(255,255,255,.5);display:block;margin-bottom:5px;font-weight:600">Mot de passe</label>';
  h += '<input id="loginPass" type="password" style="width:100%;padding:12px 16px;border-radius:12px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.08);color:#fff;font-size:15px;outline:none" placeholder="••••••••" onkeydown="if(event.key===\'Enter\')doLogin()"></div>';
  h += '<button onclick="doLogin()" style="width:100%;padding:14px;border-radius:12px;background:linear-gradient(135deg,var(--gold,#d4a843),#b8960f);color:#000;font-weight:800;font-size:16px;border:none;cursor:pointer;box-shadow:0 4px 16px rgba(212,168,67,.3);transition:transform .15s" onmouseover="this.style.transform=\'translateY(-1px)\'" onmouseout="this.style.transform=\'none\'">Se connecter</button>';
  h += '<div style="text-align:center;margin-top:16px;font-size:12px;color:rgba(255,255,255,.35)">Pas encore de compte ? <a href="inscription.html" style="color:#c8a84e;font-weight:700;text-decoration:none">Inscrire mon \u00e9tablissement \u2192</a></div>';
  h += '<div style="text-align:center;margin-top:8px"><a href="#" onclick="doResetPwd()" style="font-size:12px;color:rgba(255,255,255,.35);text-decoration:none">Mot de passe oublié ?</a></div>';
  h += '</div></div>';
  // Hide the header
  var hdr = document.getElementById("hdr");
  if (hdr) hdr.style.display = "none";
  el.innerHTML = h;
}

function showLoginError(msg) {
  var el = document.getElementById("loginError");
  if (el) { el.style.display = "block"; el.textContent = msg; }
}

// Login
async function doLogin() {
  if (!_sb) { showLoginError("Erreur de connexion au serveur"); return; }
  var email = document.getElementById("loginEmail").value.trim();
  var pass = document.getElementById("loginPass").value;
  if (!email || !pass) { showLoginError("Remplissez email et mot de passe"); return; }

  var result = await _sb.auth.signInWithPassword({ email: email, password: pass });
  if (result.error) { showLoginError(result.error.message); return; }

  _userId = result.data.user.id;
  // Initialise lx_salon_last_activity pour que le check au prochain boot
  // démarre à partir de maintenant (sinon Infinity = expire immédiatement)
  try { localStorage.setItem("lx_salon_last_activity", Date.now().toString()); } catch(_){}
  await loadSalonData();
}

// Signup — handled by inscription.html (4-step flow with SIRET, contrat, etc.)
// doSignup() removed — was dead code creating incomplete salons without SIRET/contrat

// Reset password
async function doResetPwd() {
  if (!_sb) return;
  var email = document.getElementById("loginEmail").value.trim();
  if (!email) { showLoginError("Entrez votre email d'abord"); return; }
  var result = await _sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/reset-password.html' });
  if (result.error) { showLoginError(result.error.message); }
  else { showLoginError("Email de réinitialisation envoyé !"); }
}

// Logout
async function doLogout() {
  // 2026-10-11 : JET 40 (arrêt / déconnexion), écrit avant la perte de session
  try { if (_sb && _salonId) await _sb.from("audit_log").insert({ salon_id: _salonId, action: "ARRET_CAISSE", details: "Déconnexion de la caisse", operator_name: (typeof CURRENT_OPERATOR !== "undefined" && CURRENT_OPERATOR) ? ((CURRENT_OPERATOR.prenom || "") + " " + (CURRENT_OPERATOR.nom || "")).trim() : "titulaire" }); } catch (_eJ) {}
  // Clear le cache IndexedDB du salon courant AVANT de perdre _salonId
  // (sécurité : un user qui se déconnecte ne doit pas laisser ses data sur la machine)
  if (_salonId) {
    try { await clearCacheForSalon(_salonId); } catch(e){}
  }
  // 2026-10-14 audit : cet appareil ne doit plus recevoir les notifications du salon apres deconnexion.
  // AVANT signOut (la suppression passe par la RLS du proprietaire). Seuls les abonnements « salon »
  // de CE salon sont touches (l'abonnement de l'espace client compte.html n'est pas concerne).
  // Borne a 3 s : la deconnexion ne doit jamais rester bloquee.
  if (_sb && _salonId) {
    try {
      await Promise.race([
        (async function () {
          if (!("serviceWorker" in navigator) || !navigator.serviceWorker.getRegistrations) return;
          var regs = await navigator.serviceWorker.getRegistrations();
          for (var i = 0; i < regs.length; i++) {
            var sub = null;
            try { sub = regs[i].pushManager ? await regs[i].pushManager.getSubscription() : null; } catch (_eS) { sub = null; }
            if (!sub || !sub.endpoint) continue;
            var del = await _sb.from("push_subscriptions").delete()
              .eq("endpoint", sub.endpoint).eq("target_type", "salon").eq("salon_id", _salonId).select("id");
            if (del && !del.error && Array.isArray(del.data) && del.data.length) { try { await sub.unsubscribe(); } catch (_eU) {} }
          }
        })(),
        new Promise(function (r) { setTimeout(r, 3000); })
      ]);
    } catch (_eP) {}
  }
  // 2026-10-14 : scope local -> ne deconnecte QUE cet appareil (le defaut "global" coupait la session sur tous les appareils du salon)
  window._lxDeconnexionVolontaire = true; // 2026-10-14 audit : pas de fenêtre « session expirée » pour une déconnexion demandée
  if (_sb) { try { await _sb.auth.signOut({ scope: "local" }); } catch(_){} }
  _salonId = null;
  _userId = null;
  _isOnline = false;
  window._cacheHydrated = false;
  // Cleanup activity markers (sinon le prochain login partirait avec un
  // timestamp d'activité de l'ancienne session)
  try { localStorage.removeItem("lx_salon_last_activity"); } catch(_){}
  try { localStorage.removeItem("lx_current_op"); } catch(_){}
  // Cleanup polling and realtime
  if(window._rdvPollInterval){clearInterval(window._rdvPollInterval);window._rdvPollInterval=null;}
  if(window._realtimeChannel&&_sb){try{_sb.removeChannel(window._realtimeChannel);}catch(e){}window._realtimeChannel=null;}
  try { sessionStorage.removeItem("luxyra_archive_mode"); } catch(_){}
  // FIX 2026-10-07 : CLOISONNEMENT ENTRE COMPTES. La deconnexion ne rechargeait pas la page :
  // equipe, prestations, clients, absences, caisse, configuration du site, horaires, minuteries
  // (rappels SMS) du compte precedent restaient EN MEMOIRE et passaient au compte suivant
  // ouvert dans le meme onglet. On recharge : la memoire repart de zero, le prochain compte
  // ne charge que ses propres donnees.
  try { window.location.replace(window.location.pathname); return; } catch(_){}
  showLoginScreen();
}

// Check session on load
// Vérifie aussi un timestamp d'inactivité salon : si > 4h depuis la
// dernière interaction réelle (PC arrêté, app fermée), on signOut et on
// redemande le login, peu importe que le JWT Supabase soit encore valide.
// Threshold 4h = compromis :
// - Couvre une pause déjeuner ou un créneau sans clients sans déranger.
// - Un PC fermé en fin de journée (>4h) déclenche bien un re-login le
//   lendemain matin.
// La sécurité opérateur reste assurée par le re-PIN à 5 min d'inactivité.
var SALON_SESSION_INACTIVITY_MS = 4 * 60 * 60 * 1000;
async function checkSession() {
  if (window._lxDemoKO) return; // 2026-10-14 audit : démo sans son module -> échec fermé (rien ne démarre)
  if (!_sb) { startOffline(); return; }
  try{
  var result = await _sb.auth.getSession();
  if (result.data && result.data.session) {
    // Check inactivité salon avant de restaurer
    var lastSalonActivity = parseInt(localStorage.getItem("lx_salon_last_activity") || "0", 10);
    var elapsed = lastSalonActivity ? (Date.now() - lastSalonActivity) : Infinity;
    if (elapsed > SALON_SESSION_INACTIVITY_MS && !window._lxVueAdmin) {
      // Session salon expirée → signOut Supabase + cleanup + login screen.
      // On vide aussi lx_current_op pour forcer le re-PIN après re-login
      // (sinon Amandine resterait active après que le salon se reconnecte).
      try { await _sb.auth.signOut({ scope: "local" }); } catch(_){} // 2026-10-14 : cet appareil seulement
      try { localStorage.removeItem("lx_current_op"); } catch(_){}
      try { localStorage.removeItem("lx_salon_last_activity"); } catch(_){}
      showLoginScreen();
      return;
    }
    _userId = result.data.session.user.id;
    // Refresh activity timestamp dès qu'on charge avec succès
    try { localStorage.setItem("lx_salon_last_activity", Date.now().toString()); } catch(_){}
    await loadSalonData();
  } else {
    if (window._lxVueAdmin) { _lxVueAdminStop("Connecte-toi d'abord au panneau admin (support@luxyra.fr) dans ce navigateur, puis rouvre la vue depuis la fiche du salon."); return; }
    try { localStorage.removeItem("lx_salon_last_activity"); } catch(_){}
    showLoginScreen();
  }
  }catch(err){ if (window._lxVueAdmin) { _lxVueAdminStop("Erreur de chargement de la vue admin."); return; } showLoginScreen();}
}
// Touch salon activity (throttle) — appelé depuis app.html sur user activity
window.lxTouchSalonActivity = function() {
  try { localStorage.setItem("lx_salon_last_activity", Date.now().toString()); } catch(_){}
};


// ============================================================
// LOAD DATA — Charger les données du salon depuis Supabase
// ============================================================

// Helper isolé : charge tickets_attente + devis depuis la DB.
// Appelé tôt dans loadSalonData() pour garantir que ces deux listes sont
// peuplées même si une étape suivante throw. Re-appelable comme filet de
// sécurité (reset window.PENDING_TK + window.DEVIS à chaque appel).
async function loadPendingAndDevis() {
  if (!_sb || !_salonId) return;
  // Tickets en attente
  try {
    var pkResAtt = await _sb.from("tickets_attente").select("*")
      .eq("salon_id", _salonId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (pkResAtt.error) {
      console.warn("[loadPendingAndDevis] tickets_attente error", pkResAtt.error);
    } else if (pkResAtt.data) {
      window.PENDING_TK = pkResAtt.data.map(function(p) {
        var raw = (p.raw_data && typeof p.raw_data === "object") ? p.raw_data : {};
        return Object.assign({}, raw, {
          dbId: p.id,
          id: raw.id || p.local_id || p.id,
          date: p.date_creation,
          time: (p.heure_creation || "").toString().slice(0,5),
          cId: lxCid(p.client_id) || raw.cId || "",
          clientName: p.client_nom || raw.clientName || "",
          stId: p.collaborateur_id || raw.stId,
          styName: p.collaborateur_nom || raw.styName || "",
          items: p.items || raw.items || [],
          remise: Number(p.remise),
          total: Number(p.total)
        });
      });
    } else {
      window.PENDING_TK = window.PENDING_TK || [];
    }
  } catch(e) {
    console.warn("[loadPendingAndDevis] tickets_attente exception", e);
    window.PENDING_TK = window.PENDING_TK || [];
  }
  // Devis
  try {
    var dvRes = await _sb.from("devis").select("*")
      .eq("salon_id", _salonId)
      .order("num", { ascending: false })
      .limit(500);
    if (dvRes.error) {
      console.warn("[loadPendingAndDevis] devis error", dvRes.error);
    } else if (dvRes.data) {
      // 2026-10-14 SECURITE : l'expiration des devis (tous les établissements) est faite par le cron serveur
      // (devis_expire_overdue_nuit, 02:10 UTC) ; la fonction n'est plus appelable depuis l'application.
      window.DEVIS = dvRes.data.map(function(d) {
        var raw = (d.raw_data && typeof d.raw_data === "object") ? d.raw_data : {};
        return Object.assign({}, raw, {
          dbId: d.id, num: d.num, date: d.date_devis, dateValidite: d.date_validite,
          cId: lxCid(d.client_id), clientName: d.client_nom || "",
          clientPrenom: d.client_prenom, clientTel: d.client_tel, clientEmail: d.client_email,
          items: d.items || [],
          total: Number(d.total_ttc), totalHT: Number(d.total_ht), totalTVA: Number(d.total_tva),
          tauxTVA: Number(d.taux_tva), totalBrut: Number(d.total_brut), remise: Number(d.total_remise),
          status: d.status, sentAt: d.sent_at, acceptedAt: d.accepted_at,
          refusedAt: d.refused_at, convertedAt: d.converted_at,
          ticketId: d.ticket_id, stId: d.collaborateur_id, stNom: d.collaborateur_nom,
          notes: d.notes || ""
        });
      });
    } else {
      window.DEVIS = window.DEVIS || [];
    }
  } catch(e) {
    console.warn("[loadPendingAndDevis] devis exception", e);
    window.DEVIS = window.DEVIS || [];
  }
}
if (typeof window !== "undefined") window.loadPendingAndDevis = loadPendingAndDevis;

// ============================================================
// HELPER : transforme une ligne DB clotures en objet JS hydraté pour window.CLOTURES.
// Centralisé pour pouvoir être réutilisé par loadSalonData() ET loadOlderClotures().
// ============================================================
function _mapClotureRow(c) {
  // raw_data = snapshot JSON complet (nouvelles clôtures). Fallback sur colonnes
  // structurées pour la rétro-compat des anciennes clôtures.
  var base = (c.raw_data && typeof c.raw_data === "object") ? c.raw_data : {};
  var totalCA = Number(c.total_ca) || 0;
  var totalHT = Number(c.total_ht) || 0;
  // 2026-10-28 (6.8.5, constat M3) : Z ancienne sans taux mémorisé -> taux DÉDUIT de ses propres montants (CA / HT scellés), jamais
  // le taux actuel de l'établissement (un changement de taux ne réécrit plus l'affichage des Z passées).
  var txTVA = (typeof base.txTVA === "number" && !isNaN(base.txTVA)) ? base.txTVA : (function(){
    var ca = Number(c.total_ca) || 0, ht = Number(c.total_ht) || 0;
    if (Math.abs(ca) < 0.005) return (typeof window.lxTauxTVA === "function" ? window.lxTauxTVA() : 20);
    var best = 20, bd = Infinity; [0, 2.1, 5.5, 8, 10, 13, 17, 20, 21].forEach(function(t){ var d = Math.abs(ht - ca / (1 + t / 100)); if (d < bd) { bd = d; best = t; } });
    return best; })();
  var totalPrest = base.totalPrest != null ? base.totalPrest : totalCA;
  var totalProd  = base.totalProd  != null ? base.totalProd  : 0;
  // FIX 2026-05-14 : applique correction documentée (raw_data.correction)
  // Hash original préservé en DB, on lit les valeurs corrigées en mémoire
  if(base.correction && typeof base.correction === "object"){
    if(base.correction.apresPrest != null) totalPrest = Number(base.correction.apresPrest)||0;
    if(base.correction.apresProd  != null) totalProd  = Number(base.correction.apresProd)||0;
  }
  return Object.assign({
    totalPrest: totalPrest,
    totalProd:  totalProd,
    totalTVA:   base.totalTVA   != null ? base.totalTVA   : (totalCA - totalHT),
    txTVA:      txTVA,
    prestHT:    base.prestHT    != null ? base.prestHT    : Math.round(totalPrest / (1 + txTVA/100) * 100) / 100,
    prestTVA:   base.prestTVA   != null ? base.prestTVA   : Math.round((totalPrest - (totalPrest / (1 + txTVA/100))) * 100) / 100,
    prodHT:     base.prodHT     != null ? base.prodHT     : Math.round(totalProd  / (1 + txTVA/100) * 100) / 100,
    prodTVA:    base.prodTVA    != null ? base.prodTVA    : Math.round((totalProd  - (totalProd  / (1 + txTVA/100))) * 100) / 100,
    totalRemises: base.totalRemises || 0,
    brutTotalGlobal: base.brutTotalGlobal || totalCA,
    totalAnnul: base.totalAnnul || 0,
    tkMin: base.tkMin || 0, tkMax: base.tkMax || 0,
    hPremier: base.hPremier || "--:--", hDernier: base.hDernier || "--:--",
    panierMoyen: base.panierMoyen != null ? base.panierMoyen : (c.nb_tickets > 0 ? Math.round(totalCA / c.nb_tickets * 100) / 100 : 0),
    details: base.details || {cb:0,esp:0,chq:0,bon:0,vir:0,aut:0},
    cumulMois: base.cumulMois || Number(c.cumul_mois_ca) || 0,
    cumulAnnuel: base.cumulAnnuel || Number(c.cumul_annee_ca) || 0
  }, base, {
    id: c.id, date: c.date_cloture, ts: c.timestamp_cloture, num: c.num,
    totalCA: totalCA, totalHT: totalHT,
    nbTickets: c.nb_tickets, nbAnnul: c.nb_annulations,
    perPay: base.perPay || c.detail_paiements || {},
    perSty: base.perSty || c.detail_collabs || {},
    cumulMoisCA: Number(c.cumul_mois_ca), cumulMoisTk: c.cumul_mois_tickets,
    cumulAnCA: Number(c.cumul_annee_ca), cumulAnTk: c.cumul_annee_tickets,
    cumulPerpetuelCA: (c.cumul_perpetuel_ca!=null?Number(c.cumul_perpetuel_ca):undefined),
    cumulPerpetuelTk: (c.cumul_perpetuel_tickets!=null?Number(c.cumul_perpetuel_tickets):undefined),
    hash: c.hash, hashAlgo: c.hash_algo
  });
}

// ============================================================
// LAZY LOAD : charge les clôtures d'un mois précis si pas encore en mémoire.
// Appelé quand l'utilisateur sélectionne un mois ancien dans la nav compta
// (sélecteurs Mois+Année). Idempotent (skip si déjà chargé). Async safe.
// ============================================================
async function loadOlderClotures(yearMonth) {
  if (!_sb || !_salonId) return { ok: false };
  if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) return { ok: false };
  // Si on a déjà des clôtures de ce mois en mémoire, on suppose qu'elles sont toutes là
  var alreadyHas = (window.CLOTURES || []).some(function(c){
    return c.date && String(c.date).indexOf(yearMonth) === 0;
  });
  if (alreadyHas) return { ok: true, skipped: true };
  // Range du mois (premier au dernier jour)
  var startDate = yearMonth + "-01";
  var endDate = yearMonth + "-31"; // PostgreSQL accepte jusqu'à 31, ignore les jours invalides
  try {
    var res = await _sb.from("clotures").select("*")
      .eq("salon_id", _salonId)
      .gte("date_cloture", startDate)
      .lte("date_cloture", endDate)
      .order("num", { ascending: true });
    if (res.error) {
      console.warn("[loadOlderClotures]", res.error);
      return { ok: false, error: res.error };
    }
    if (!res.data || !res.data.length) return { ok: true, count: 0 };
    var newOnes = res.data.map(_mapClotureRow);
    var existingIds = new Set((window.CLOTURES || []).map(function(c){return c.id;}));
    var toAdd = newOnes.filter(function(c){return !existingIds.has(c.id);});
    if (toAdd.length) {
      window.CLOTURES = (window.CLOTURES || []).concat(toAdd).sort(function(a,b){return (a.num||0) - (b.num||0);});
      // FIX 2026-05-12 : sync LOCKED_DAYS aussi pour ces nouvelles clôtures
      if (!window.LOCKED_DAYS) window.LOCKED_DAYS = {};
      toAdd.forEach(function(c){ if (c && c.date) window.LOCKED_DAYS[c.date] = true; });
      try { localStorage.setItem("_cp_locked", JSON.stringify(window.LOCKED_DAYS)); } catch(_){}
      console.log("[loadOlderClotures] +"+toAdd.length+" clôtures pour "+yearMonth);
    }
    return { ok: true, count: toAdd.length };
  } catch (e) {
    console.warn("[loadOlderClotures] exception", e);
    return { ok: false, error: e };
  }
}
if (typeof window !== "undefined") window.loadOlderClotures = loadOlderClotures;

// ============================================================================
// FIX 2026-07-11 : MAPPER UNIQUE ligne DB `appointments` -> objet AP en memoire.
// ----------------------------------------------------------------------------
// AVANT : la conversion existait en DOUBLE — une version complete dans
// loadSalonData (chargement initial) et une version TRONQUEE, recopiee deux fois,
// dans reloadFromSupabase("appointments") (poll 30 s, resync au refocus, merge
// realtime). La version tronquee oubliait : hash / prev_hash / hash_algo,
// brut_total, remise, heure_encaissement, payments, ticket_html, clients,
// is_cancel / cancel_ref / contra_same_day, et la reconstruction du cId
// "passage-H/F/E" depuis pass_type.
// CONSEQUENCES (salon sur 2 appareils) :
//   - un contre-ticket d'annulation cree sur l'appareil A et recupere par le poll
//     de l'appareil B arrivait SANS contra_same_day -> RE-COMPTE dans le CA et la
//     cloture Z de B (chiffres faux sur le 2e appareil) ;
//   - un ticket encaisse sur A arrivait sur B sans hash / sans payments
//     (ventilation des reglements de la Z fausse, chaine NF525 incomplete) ;
//   - pire : sur une ligne DEJA en memoire, le merge ECRASAIT cId="passage-F"
//     avec client_id=null (colonne vide pour un walk-in) -> le genre du passage
//     etait perdu toutes les 30 s.
// DESORMAIS : une seule fonction, utilisee par loadSalonData ET par les deux
// merges de reloadFromSupabase -> impossible de re-diverger.
// LECTURE SEULE : aucune ecriture ajoutee, aucun champ scelle modifie.
// ============================================================================
// 2026-10-14 audit : un rendez-vous NON encaissé annulé par l'établissement est désormais CONSERVÉ en base
// (status 'cancelled', cancelled=true, cancel_date) au lieu d'être supprimé : historique + alerte « créneau
// libéré ». Il ne doit jamais revenir dans AP (planning, conflits, stats, et surtout les écrans fiscaux qui
// lisent `cancelled && cancelDate` = tickets annulés). Un ticket (ticket_num / hash / contre-ticket) est gardé.
function lxApptAnnuleSansTicket(a) {
  if (!a) return false;
  var st = (a.status !== undefined) ? a.status : a.st;
  if (st !== "cancelled") return false;
  var tk = (a.ticket_num !== undefined) ? a.ticket_num : a.tkNum;
  var h = a.hash;
  var ic = (a.is_cancel !== undefined) ? a.is_cancel : a.isCancel;
  return !tk && !(h && String(h) !== "") && ic !== true;
}
if (typeof window !== "undefined") window.lxApptAnnuleSansTicket = lxApptAnnuleSansTicket;
function lxMapApptRow(a) {
  // FIX 2026-05-13 : reconstruit cId="passage-X" depuis la colonne pass_type
  // (preserve le genre choisi au RDV meme apres un reload / un merge).
  var _cId = lxCid(a.client_id);
  if (!_cId && a.pass_type && ["H","F","E"].indexOf(a.pass_type) >= 0) {
    _cId = "passage-" + a.pass_type;
  }
  // Migration legacy : si pas de pass_type mais comment contient marqueur, utiliser
  else if (!_cId && a.comment) {
    if (a.comment.indexOf("passage-E") >= 0) _cId = "passage-E";
    else if (a.comment.indexOf("passage-H") >= 0) _cId = "passage-H";
    else if (a.comment.indexOf("passage-F") >= 0) _cId = "passage-F";
  }
  var _ap = {
    id: a.id, cId: _cId, sId: a.service_id, stId: a.collab_id,
    date: a.date_rdv, time: a.heure, pr: Number(a.prix),
    heureEncaiss: a.heure_encaissement || null,
    brutTotal: a.brut_total ? Number(a.brut_total) : undefined,
    remise: Number(a.remise || 0),
    st: a.status, met: a.mode_paiement,
    tkNum: a.ticket_num, hash: a.hash, prevHash: a.prev_hash, hashAlgo: a.hash_algo,
    items: a.items || [], comment: a.comment || "",
    // FIX 2026-07-11 : ticket_html etait ecrit mais JAMAIS relu -> voir saveAppointment.
    ticketHtml: a.ticket_html || null,
    aPhases: a.a_phases || [],
    clients: a.clients || [], fromCaisse: a.from_caisse || false,
    cancelled: a.cancelled, cancelReason: a.cancel_reason,
    // FIX 2026-07-11 : marqueurs du CONTRE-TICKET d'annulation (avant : memoire seule,
    // jamais relus -> apres un reload le contre-ticket negatif etait RE-COMPTE dans le
    // CA du jour et la cloture Z). contraSameDay : la paire original+contra du MEME JOUR
    // doit netter a ZERO. Un contra CROSS-DAY reste false -> toujours compte.
    isCancel: a.is_cancel === true,
    cancelRef: (a.cancel_ref != null ? a.cancel_ref : null),
    contraSameDay: a.contra_same_day === true,
    // FIX 2026-05-13 : relit le detail des paiements (mode/amount/given/rendu)
    // pour que le rendu monnaie reapparaisse sur les re-impressions
    payments: (a.payments && Array.isArray(a.payments) && a.payments.length > 0) ? a.payments : null
  };
  // FIX 2026-07-11 : restitue la DATE et le MOTIF d annulation apres un rechargement.
  // Les ecrans/exports filtrent sur `cancelled && cancelDate` et affichent `cancelReason`
  // (Z, exports CSV/Excel) ou `cancelMotif` (bande mensuelle, archive annuelle) : sans ce
  // remapping, une annulation rechargee perdait sa date ET son motif.
  // Cles ajoutees UNIQUEMENT sur une ligne annulee -> un ticket/RDV normal garde EXACTEMENT
  // la meme forme qu avant (aucune cle en plus, aucune valeur changee).
  if (a.cancelled) {
    if (a.cancel_date) _ap.cancelDate = String(a.cancel_date).slice(0, 10);
    if (a.cancel_reason) _ap.cancelMotif = a.cancel_reason;
  }
  // Acompte : seul support persiste = items[].isAcompteData (cf. doSaveAcompte).
  // Restitue ici pour que le merge cross-appareils voie l'acompte comme le loader
  // (initApp faisait deja cette passe apres loadSalonData -> devient un no-op).
  if (_ap.items && _ap.items.length) {
    for (var _ii = 0; _ii < _ap.items.length; _ii++) {
      var _it = _ap.items[_ii];
      if (_it && _it.isAcompteData) {
        _ap.acompte = _it.acompte; _ap.acompteMode = _it.acompteMode;
        _ap.acompteDate = _it.acompteDate; _ap.acompteTkNum = _it.acompteTkNum || null;
        if (_it.acompteEnLigneTicket === true) _ap.acompteEnLigneTicket = true; // 2026-10-14 (NF525 acompte en ligne) : acompte en ligne déjà scellé (RDV relibéré) -> déduit au ticket final
        break;
      }
    }
  }
  // 2026-10-10 : sur un ticket ENCAISSÉ, l'élément technique de l'acompte (acompte en ligne conservé à
  // l'encaissement) ne doit pas apparaître comme une ligne dans les stats, listes, exports et historiques.
  // L'acompte reste porté par _ap.acompte ; saveAppointment le ré-ajoute à chaque enregistrement.
  if ((_ap.st === "done" || _ap.tkNum) && _ap.items && _ap.items.length) {
    _ap.items = _ap.items.filter(function (x) { return !(x && x.isAcompteData && /ligne|stripe|online/i.test(String(x.acompteMode || ""))); });
  }
  // lieu / adresse_domicile : colonnes JAMAIS ecrites par saveAppointment (RDV a domicile
  // saisi en memoire seulement). On ne pose la cle QUE si la base a une valeur -> le merge
  // ne peut plus ecraser avec null le "domicile" saisi localement (l'ancien mapping du poll
  // le faisait toutes les 30 s). Absence de cle == null pour tous les lecteurs
  // (`a.lieu==="domicile"`, `if(a.adresse)`).
  if (a.lieu) _ap.lieu = a.lieu;
  if (a.adresse_domicile) _ap.adresse = a.adresse_domicile;
  // FIX 2026-07-11 : `printed` (ticket deja imprime -> une reimpression doit porter la mention
  // DUPLICATA). Colonne existante mais jamais relue : apres un rechargement, un ticket deja
  // imprime repartait "vierge" et sa reimpression ne portait plus la banniere DUPLICATA.
  // Cle posee UNIQUEMENT si true -> forme d'un RDV normal inchangee (absence de cle == false
  // pour tous les lecteurs : `!!a.printed`, `a.printed||false`).
  if (a.printed === true) _ap.printed = true;
  // 2026-10-14 (NF525) : restitue les champs de ticket conservés dans appointments.meta (opérateur, poste,
  // horodatage, clients supplémentaires, nom client figé, drapeaux acompte / retenue / annulation d'acompte,
  // ticket d'origine, bons cadeaux utilisés, n° serveur). Clés posées UNIQUEMENT si présentes -> un RDV sans
  // meta garde exactement la même forme qu'avant.
  try {
    if (a.meta && typeof a.meta === "object" && !Array.isArray(a.meta)) {
      for (var _mk in a.meta) {
        if (!Object.prototype.hasOwnProperty.call(a.meta, _mk)) continue;
        if (_LX_APPT_META_KEYS.indexOf(_mk) < 0) continue;
        var _mv = a.meta[_mk];
        if (_mv === undefined || _mv === null) continue;
        _ap[_mk] = _mv;
      }
    }
  } catch (_eMeta) {}
  // 2026-10-28 (-3, v6.8.1) : copie d'un ticket créé par le serveur (paiement en ligne) : appointments.ticket_num est vide
  // (les versions < 6.8.1 ne voient donc jamais la série 900001+), le n° imprimé est dans meta.tkNumServeur.
  if ((_ap.tkNum === null || _ap.tkNum === undefined) && Number(_ap.tkNumServeur) > 0) _ap.tkNum = Number(_ap.tkNumServeur);
  return _ap;
}
if (typeof window !== "undefined") window.lxMapApptRow = lxMapApptRow;

// ============================================================
// MAPPER UNIQUE DB -> CL (clients)
// FIX 2026-08-04 : la conversion ligne DB -> objet client existait en DOUBLE
// (loadSalonData ici, ET une copie TRONQUEE dans reloadFromSupabase("clients")
// cote app.html). La copie tronquee oubliait :
//   - le DEBALLAGE de fiche_tech (formules couleur, photos avant/apres,
//     allergies, type de peau/ongles/bien-etre... = _FICHE_TECH_KEYS)
//   - acompteOnline, acqSrc, acqParrain, famille_ids
// Or reloadFromSupabase("clients") fait CL = data.map(...) = REMPLACEMENT
// INTEGRAL (poll 30 s / realtime / refocus) et saveClient reconstruit
// fiche_tech A PARTIR DE LA MEMOIRE -> apres un simple resync, la sauvegarde
// suivante ecrivait fiche_tech={}, acompte_online='defaut', famille_ids=[],
// acquisition_*=null => EFFACEMENT EN BASE, en silence.
// Un seul mapper partage par les deux chemins => impossible de re-diverger.
// (Meme remede que lxMapApptRow, commit 4e3b515.)
// ============================================================
// ============================================================
// 2026-10-07 : SYNCHRONISATION ENTRE APPAREILS — FICHES CLIENTS ET PRODUITS
// Avant : saveClient / saveProduct reecrivaient la fiche ENTIERE depuis la memoire de l'appareil.
// Un telephone ouvert avant une modification faite sur la tablette (points de fidelite, fiche
// technique, stock vendu...) l'effacait a sa prochaine sauvegarde. Desormais chaque fiche garde
// une reference (_lxBase, non enumerable) = son etat au chargement ; a la sauvegarde on relit la
// base et on n'ecrit que ce qui a change sur CET appareil. Compteurs (points, stock) : on applique
// la DIFFERENCE faite ici sur la valeur en base, donc deux appareils qui ajoutent chacun des points
// ou vendent chacun un produit s'additionnent au lieu de s'ecraser.
// ============================================================
function _lxCanon(v){
  if(v===undefined) return undefined;
  if(v===null || typeof v!=="object") return JSON.stringify(v);
  if(Array.isArray(v)) return "["+v.map(function(x){ var c=_lxCanon(x); return c===undefined?"null":c; }).join(",")+"]";
  var ks=Object.keys(v).sort(), out=[];
  for(var i=0;i<ks.length;i++){ var c=_lxCanon(v[ks[i]]); if(c!==undefined) out.push(JSON.stringify(ks[i])+":"+c); }
  return "{"+out.join(",")+"}";
}
function _lxBaseDe(data){ var b={}; Object.keys(data).forEach(function(k){ b[k]=_lxCanon(data[k]); }); return b; }
function _lxPoserBase(obj, base){ try{ Object.defineProperty(obj,"_lxBase",{value:base,enumerable:false,writable:true,configurable:true}); }catch(_e){} }
function _lxNum(x){ var n=Number(x); return isNaN(n)?0:n; }
// Liste sans identifiant (ex. fiches techniques) : base + ajouts faits ici - suppressions faites ici.
function _lxFusionListe(baseL, memL, dbL){
  baseL=Array.isArray(baseL)?baseL:[]; memL=Array.isArray(memL)?memL:[]; dbL=Array.isArray(dbL)?dbL:[];
  var cB={}, cM={}, cD={};
  baseL.forEach(function(x){ var k=_lxCanon(x); cB[k]=(cB[k]||0)+1; });
  memL.forEach(function(x){ var k=_lxCanon(x); cM[k]=(cM[k]||0)+1; });
  var out=[];
  dbL.forEach(function(x){ var k=_lxCanon(x); if(cB[k] && !cM[k]) { return; } out.push(x); cD[k]=(cD[k]||0)+1; }); // supprime ici -> retire
  memL.forEach(function(x){ var k=_lxCanon(x); if(!cB[k] && !cD[k]) { out.push(x); cD[k]=1; } });                  // ajoute ici -> ajoute
  return out;
}
// Fusion generique. compteurs : colonnes ou l'on applique la difference ; listes : fusion de liste ;
// objets : fusion cle par cle ; absolus : colonnes « compteur » a ecrire telles quelles si modifiees ici.
// Conflit = le MEME champ modifie ici ET sur un autre appareil depuis le chargement.
// Texte complete des deux cotes (ex. notes) : les deux ajouts sont gardes. Sinon : la version de cet
// appareil (la plus recente) est gardee et l'autre est consignee dans opts.conflits (journal), rien ne se perd.
function _lxFusionTexte(baseTxt, memTxt, dbTxt){
  baseTxt=String(baseTxt||""); memTxt=String(memTxt||""); dbTxt=String(dbTxt||"");
  if(memTxt.indexOf(baseTxt)===0 && dbTxt.indexOf(baseTxt)===0){
    var ajoutIci=memTxt.slice(baseTxt.length);
    if(ajoutIci.length && dbTxt.slice(-ajoutIci.length)===ajoutIci) return dbTxt;
    return dbTxt + ajoutIci;
  }
  return null;
}
function _lxFusionFiche(base, mem, db, opts){
  opts=opts||{}; var out={};
  var cles={}; Object.keys(mem).forEach(function(k){cles[k]=1;}); Object.keys(db).forEach(function(k){cles[k]=1;});
  Object.keys(cles).forEach(function(k){
    var memS=_lxCanon(mem[k]), change=(memS!==base[k]);
    if(mem[k]===undefined && db[k]===undefined) return;
    if(!change){ if(db[k]!==undefined) out[k]=db[k]; else out[k]=mem[k]; return; }
    if(opts.compteurs && opts.compteurs.indexOf(k)>=0 && !(opts.absolus && opts.absolus.indexOf(k)>=0)){
      var b=(base[k]===undefined)?0:_lxNum(JSON.parse(base[k])); out[k]=_lxNum(db[k])+(_lxNum(mem[k])-b); return;
    }
    if(opts.listes && opts.listes.indexOf(k)>=0){ out[k]=_lxFusionListe(base[k]?JSON.parse(base[k]):[], mem[k], db[k]); return; }
    if(opts.objets && opts.objets.indexOf(k)>=0){
      var bo=base[k]?JSON.parse(base[k]):{}, mo=mem[k]||{}, dO=db[k]||{}, r=JSON.parse(JSON.stringify(dO)), ks={};
      Object.keys(bo).forEach(function(x){ks[x]=1;}); Object.keys(mo).forEach(function(x){ks[x]=1;});
      Object.keys(ks).forEach(function(x){ if(_lxCanon(mo[x])!==_lxCanon(bo[x])){
        if(opts.conflits && _lxCanon(dO[x])!==_lxCanon(bo[x]) && _lxCanon(dO[x])!==_lxCanon(mo[x])) opts.conflits.push({ champ:k+"."+x, remplace:dO[x], garde:mo[x] });
        if(mo[x]===undefined) delete r[x]; else r[x]=mo[x]; } });
      out[k]=r; return;
    }
    var dbChange=(_lxCanon(db[k])!==base[k]) && (_lxCanon(db[k])!==memS);
    if(dbChange && typeof mem[k]==="string" && (typeof db[k]==="string" || db[k]==null)){
      var b0=base[k]?JSON.parse(base[k]):""; var f=_lxFusionTexte(b0, mem[k], db[k]);
      if(f!==null){ out[k]=f; return; }
    }
    if(dbChange && opts.conflits) opts.conflits.push({ champ:k, remplace:db[k], garde:mem[k] });
    out[k]=mem[k];
  });
  return out;
}
// Signale un conflit : journal (non fiscal) + message a l'utilisateur.
function _lxSignalerConflits(type, nom, conflits){
  if(!conflits || !conflits.length) return;
  try{
    var champs=conflits.map(function(c){ return c.champ; }).join(", ");
    if(typeof auditLog==="function") auditLog("CONFLIT_SYNCHRO", (type+" « "+(nom||"?")+" » : "+conflits.map(function(c){ return c.champ+" — valeur remplacee : "+JSON.stringify(c.remplace); }).join(" ; ")).slice(0,1900));
    if(typeof toast==="function") toast("Cette fiche a aussi \u00e9t\u00e9 modifi\u00e9e sur un autre appareil ("+champs+") : votre version est enregistr\u00e9e, l\u2019autre reste dans le journal.","warning");
  }catch(_e){}
}

// 2026-10-13 : fusion de fiches clients — id fiche fusionnée -> id fiche gardée (affichage uniquement)
window._lxFusion = window._lxFusion || {};
function lxMajFusions(rows) {
  var m = {};
  (rows || []).forEach(function (c) { if (c && c.fusionne_dans) m[c.id] = c.fusionne_dans; });
  window._lxFusion = m;
}
function lxCid(id) { var m = window._lxFusion || {}; var n = 0; while (id && m[id] && n < 5) { id = m[id]; n++; } return id; }
window.lxMajFusions = lxMajFusions; window.lxCid = lxCid;
function lxMapClientRow(c) {
  var obj = {
    id: c.id, nom: c.nom, pre: c.prenom, sex: c.sexe,
    ph: c.telephone, ph2: c.telephone2, em: c.email,
    adr: c.adresse, cp: c.cp, ville: c.ville, ddn: c.date_naissance,
    cr: c.created_at ? c.created_at.slice(0,10) : "",
    no: c.notes, natChev: c.nature_cheveux, typeChev: c.type_cheveux,
    detChev: c.details_cheveux, collab: c.collab_pref,
    actif: c.actif, fid: c.points_fidelite,
    smsOk: c.sms_ok, emOk: c.email_ok, fiches: c.fiches || [],
    clientBeautyproId: c.client_luxyra_id || null,
    acompteOnline: c.acompte_online || 'defaut',
    acqSrc: c.acquisition_source || null,
    acqParrain: c.acquisition_parrain || null,
    famille_ids: Array.isArray(c.famille_ids) ? c.famille_ids : []
  };
  // Deballe la fiche technique etendue (peau, ongles, bien-etre, formules
  // couleur, photos...) sur l'objet client : le code UI lit directement
  // c.typePeau / c.formules / c.photos / etc.
  if (c.fiche_tech && typeof c.fiche_tech === "object") {
    for (var k in c.fiche_tech) {
      if (Object.prototype.hasOwnProperty.call(c.fiche_tech, k)) {
        obj[k] = c.fiche_tech[k];
      }
    }
  }
  _lxPoserBase(obj, _lxBaseDe(_lxClientData(obj))); // 2026-10-07 : reference pour la synchro entre appareils
  return obj;
}
if (typeof window !== "undefined") window.lxMapClientRow = lxMapClientRow;

// 2026-10-14 audit : mapper unique DB -> T (collaborateurs), partagé par loadSalonData et le rafraîchissement.
function lxMapCollabRow(c) {
  return { id: c.id, n: c.nom, i: c.initiales, c: c.couleur, img: c.img || "",
           hrs: c.horaires || {}, pause: c.pause || null,
           // FIX 2026-05-12 : nouveau champ horaires_overrides (mode Personnalisés)
           // Format : { "YYYY-MM-DD": {o,c,pause_o?,pause_c?} | null }
           hrsOver: c.horaires_overrides || {},
           dateEntree: c.date_entree || null, dateDepart: c.date_depart || null,
           inactif: c.inactif === true,
           photoVisible: c.photo_visible !== false,
           competences: c.competences || {all:true} };
}
if (typeof window !== "undefined") window.lxMapCollabRow = lxMapCollabRow;

// 2026-10-14 audit : rafraîchissement des CLIENTS par FUSION (avant : CL remplacé en bloc toutes les 30 s).
//  - résultat vide alors que la liste locale ne l'est pas -> ignoré (journalisé) ;
//  - fiche avec une modification locale non confirmée (file de secours / échec signalé) -> version locale gardée ;
//  - fiche jamais confirmée en base (pas de _lxBase : création pas encore transmise) -> gardée ;
//  - fiche confirmée auparavant et absente maintenant -> supprimée / fusionnée sur un autre appareil : retirée
//    (sauf si le résultat a pu être tronqué à 1000 lignes) ;
//  - les objets existants sont mis à jour sur place (les écrans ouverts gardent la même fiche).
function lxFusionnerClients(rows) {
  try {
    if (!Array.isArray(rows)) return false;
    var cur = (typeof CL !== "undefined" && Array.isArray(CL)) ? CL : [];
    if (!rows.length && cur.length) { console.warn("[sync clients] résultat vide ignoré (liste locale : " + cur.length + " fiche(s))"); return false; }
    lxMajFusions(rows);
    var attente = {};
    window._walGetAll().forEach(function(e){ if (e && !e.synced && e.type === "client" && e.salon_id === _salonId && e.data && e.data.id) attente[e.data.id] = 1; });
    var parId = {}; cur.forEach(function(c){ if (c && c.id) parId[c.id] = c; });
    var vus = {}, out = [];
    rows.forEach(function(row){
      if (!row || row.fusionne_dans) return;
      vus[row.id] = 1;
      if (row.rgpd_anonymise_le) return; // 2026-10-14 audit clients : fiche anonymisée (effacement RGPD) retirée, jamais gardée localement
      var loc = parId[row.id];
      if (loc && (attente[row.id] || loc._lxNonEnregistre)) { out.push(loc); return; }
      var m = lxMapClientRow(row);
      if (loc) { Object.keys(m).forEach(function(k){ loc[k] = m[k]; }); _lxPoserBase(loc, m._lxBase); out.push(loc); }
      else out.push(m);
    });
    var tronque = rows.length >= 1000;
    cur.forEach(function(c){
      if (!c || !c.id || vus[c.id]) return;
      if (window._lxFusion && window._lxFusion[c.id]) return; // fiche fusionnée dans une autre
      if (tronque || !c._lxBase || attente[c.id] || c._lxNonEnregistre) out.push(c);
    });
    CL = out;
    return true;
  } catch(e) { console.warn("[sync clients] fusion", e); return false; }
}
if (typeof window !== "undefined") window.lxFusionnerClients = lxFusionnerClients;

// 2026-10-14 audit : rafraîchissement de l'ÉQUIPE par fusion (avant : T remplacé en bloc).
function lxFusionnerCollabs(rows) {
  try {
    if (!Array.isArray(rows)) return false;
    var cur = (typeof T !== "undefined" && Array.isArray(T)) ? T : [];
    if (!rows.length && cur.length) { console.warn("[sync équipe] résultat vide ignoré (équipe locale : " + cur.length + ")"); return false; }
    var connus = window._lxCollabIdsServeur || null;
    var parId = {}; cur.forEach(function(c){ if (c && c.id != null) parId[c.id] = c; });
    var vus = {}, out = [];
    rows.forEach(function(row){
      if (!row) return;
      vus[row.id] = 1;
      var m = lxMapCollabRow(row), loc = parId[row.id];
      if (loc) { Object.keys(m).forEach(function(k){ loc[k] = m[k]; }); out.push(loc); } else out.push(m);
    });
    cur.forEach(function(c){
      if (!c || vus[c.id]) return;
      if (connus && c.id != null && connus[c.id]) return; // connu en base puis absent : supprimé ailleurs
      out.push(c); // pas encore enregistré
    });
    window._lxCollabIdsServeur = vus;
    T = out;
    return true;
  } catch(e) { console.warn("[sync équipe] fusion", e); return false; }
}
if (typeof window !== "undefined") window.lxFusionnerCollabs = lxFusionnerCollabs;

// ============================================================
// MAPPER UNIQUE DB -> RDV_ONLINE
// FIX 2026-08-04 : cette conversion existait en TRIPLE (loadSalonData ici, le merge
// de reloadFromSupabase("rdv_online") et le push du poll 30 s, tous deux dans
// app.html), avec TROIS listes de champs DIFFERENTES. Le merge de reloadFromSupabase
// fait window.RDV_ONLINE = data.map(...) = REMPLACEMENT INTEGRAL -> apres la moindre
// reservation/annulation en ligne, il effacait en memoire : email, luxyraId,
// collabNom, salonId, confirmedAt, acompteRembourse, refundedAt, stripePaymentId et
// tout le bloc empreinte. Consequence concrete : un acompte REMBOURSE redevenait
// "net recu" dans le bordereau Stripe (regression silencieuse du fix bc032d1) et le
// RDV ne se rattachait plus a la fiche client (_lxResolveClientId lit email/luxyraId).
// Ce mapper est l'UNION STRICTE des trois anciennes versions (aucun champ perdu).
// ============================================================
function lxMapRdvOnlineRow(r) {
  return {
    id: r.id, salonId: r.salon_id,
    nom: r.client_nom, prenom: r.client_prenom, tel: r.client_tel, email: r.client_email,
    luxyraId: r.client_luxyra_id || null,
    svcId: r.service_id, svcNom: r.service_nom, svcPrix: Number(r.service_prix),
    items: r.items || null,
    salonEdit: r.salon_edit || null, // 2026-10-11 : contenu modifié par l'établissement (phases + prestations)
    salonModifAt: r.salon_modified_at || null, salonModifVue: r.salon_modified_acknowledged_by_client === true, salonModifVueAt: r.salon_modified_acknowledged_at || null, // 2026-10-11
    collabId: r.collaborateur_id, collabNom: r.collaborateur_nom,
    date: r.date_rdv, heure: r.heure_rdv ? r.heure_rdv.slice(0,5) : null,
    duree: r.duree_minutes,
    acompte: Number(r.acompte_montant), acomptePaye: r.acompte_paye, acomptePayeAt: r.acompte_paye_at || null,
    acompteRembourse: r.acompte_rembourse || false,
    acompteRembourseMontant: Number(r.acompte_rembourse_montant) || 0, // 2026-10-13 : remboursement partiel
    refundedAt: r.refunded_at || null,
    // 2026-10-14 (NF525 acompte en ligne) : nouveau modèle (ticket scellé au paiement) : acompte_modele='ticket',
    // n° du ticket d'acompte, historique des remboursements (chaque entrée porte tk une fois ticketée), retenue définitive.
    acompteModele: r.acompte_modele || null,
    acompteTkNum: r.acompte_tk_num || null,
    acompteTkClaimAt: r.acompte_tk_claim_at || null,
    remboursements: Array.isArray(r.remboursements) ? r.remboursements : [],
    retenueAt: r.retenue_at || null,
    retenueTkNum: r.retenue_tk_num || null,
    stripePaymentId: r.payment_intent_id || null,
    status: r.status, message: r.message,
    createdAt: r.created_at, confirmedAt: r.confirmed_at,
    isOnline: true,
    paymentIntentId: r.payment_intent_id || null,
    empreinteStatus: r.empreinte_status || "none",
    empreinteAmount: r.empreinte_amount ? Number(r.empreinte_amount) : null,
    empreinteHeldAt: r.empreinte_held_at || null,
    empreinteCapturedAt: r.empreinte_captured_at || null,
    empreinteReleasedAt: r.empreinte_released_at || null,
    modification_demandee: r.modification_demandee,
    modification_date: r.modification_date,
    modification_heure: r.modification_heure,
    modification_message: r.modification_message,
    modification_status: r.modification_status,
    cancelled_by: r.cancelled_by, cancel_reason: r.cancel_reason, cancelled_at: r.cancelled_at,
    // 2026-10-10 : RDV à domicile (lieu, adresse du client, frais de déplacement) + remise carte
    lieu: r.lieu || null,
    adresse: [r.client_adresse, [r.client_adresse_cp, r.client_adresse_ville].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null,
    adresseComplement: r.adresse_complement || null,
    adresseRue: r.client_adresse || null, adresseCp: r.client_adresse_cp || null, adresseVille: r.client_adresse_ville || null,
    clientLat: (r.client_lat != null ? Number(r.client_lat) : null), clientLng: (r.client_lng != null ? Number(r.client_lng) : null),
    distanceKm: (r.distance_km != null ? Number(r.distance_km) : null),
    fraisDepl: Number(r.frais_deplacement_montant) || 0,
    remiseCarte: Number(r.remise_carte_montant) || 0
  };
}
if (typeof window !== "undefined") window.lxMapRdvOnlineRow = lxMapRdvOnlineRow;

// ============================================================
// ECRIVAIN DEDIE des colonnes top-level de `salons`
// FIX 2026-08-04 : deux `saveSalonConfig` coexistaient (ici et dans app.html).
// app.html etant charge APRES, sa version ecrasait celle-ci -> la seule qui savait
// ecrire nom/adresse/tel/email/siret/tva/logo/taux_tva/metier/... etait DU CODE MORT.
// Resultat : "✅ Infos enregistrees" et "✅ Taux de TVA modifie" s'affichaient, mais
// RIEN n'etait ecrit -> retour aux anciennes valeurs au rechargement.
// On n'ajoute PAS ces colonnes au payload generique de saveSalonConfig (appele depuis
// des dizaines d'endroits) : un seul ecrivain explicite, appele par les 2 ecrans
// concernes, avec les valeurs VALIDEES. Evite notamment de reecrire `taux_tva` par
// effet de bord (le loader fait `salon.taux_tva || 20` : un salon en franchise de TVA
// a 0 % serait repasse a 20 % => corruption fiscale).
// ============================================================
// 2026-10-14 : retourne TOUJOURS une promesse de {ok, error} (error = null si ok, compatible
// avec les appelants qui testent res.error). Hors ligne ou erreur reseau : alerte (sauf
// __silencieux), plus jamais de retour muet. 0 ligne modifiee (droits) = echec.
function lxSaveSalonColumns(patch) {
  var _silence = !!(patch && patch.__silencieux);
  var _alerte = function(msg){ try { if (!_silence && typeof showAlert === "function") showAlert(msg, "warning"); } catch(_e) {} };
  try {
    if (!patch) return Promise.resolve({ ok:false, error:{ message:"rien a enregistrer" } });
    if (!_salonId) return Promise.resolve({ ok:false, error:{ message:"non connecte" } });
    var data = {};
    for (var k in patch) {
      if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
      var v = patch[k];
      if (k === "__silencieux") continue;
      if (k === "siret" && !String(v || "").trim()) continue; // 2026-10-13 : jamais de SIRET vide
      if (v === undefined || v === null) continue;      // jamais de NULL par omission
      if (typeof v === "number" && !isFinite(v)) continue; // jamais de NaN
      data[k] = v;
    }
    if (Object.keys(data).length === 0) return Promise.resolve({ ok:true, error:null, vide:true });
    if (!_isOnline || !_sb) {
      _alerte("\u26a0\ufe0f Pas de connexion au serveur : r\u00e9glage NON enregistr\u00e9. V\u00e9rifiez Internet puis recommencez.");
      return Promise.resolve({ ok:false, offline:true, error:{ message:"hors ligne" } });
    }
    return _sb.from("salons").update(data).eq("id", _salonId).select("id").then(function(res){
      if (res && res.error) {
        console.warn("lxSaveSalonColumns:", res.error.message);
        // 2026-10-13 : plus jamais d'échec silencieux d'un réglage (l'utilisateur croyait avoir enregistré)
        try { _alerte("\u26a0\ufe0f R\u00e9glage non enregistr\u00e9 : " + String(res.error.message || "erreur").replace(/^.*?:\s*/, "") + ". R\u00e9essayez ou \u00e9crivez au support.");
              if (typeof saveAuditEntry === "function") saveAuditEntry("DB_ERROR", JSON.stringify({ fn: "lxSaveSalonColumns", champs: Object.keys(data), msg: String(res.error.message || "").slice(0, 200) })); } catch (_eA) {}
        return { ok:false, error:res.error };
      }
      if (!res || !res.data || !res.data.length) {
        _alerte("\u26a0\ufe0f R\u00e9glage non enregistr\u00e9 (aucune modification accept\u00e9e par le serveur). R\u00e9essayez ou \u00e9crivez au support.");
        return { ok:false, error:{ message:"aucune ligne modifiee" } };
      }
      return { ok:true, error:null, data:res.data };
    }, function(e){
      console.warn("lxSaveSalonColumns exception:", e);
      _alerte("\u26a0\ufe0f R\u00e9glage non enregistr\u00e9 : probl\u00e8me de connexion. R\u00e9essayez.");
      return { ok:false, error:{ message:(e && e.message) || "erreur reseau" } };
    });
  } catch (e) { console.warn("lxSaveSalonColumns threw:", e); return Promise.resolve({ ok:false, error:{ message:String(e && e.message || e) } }); }
}
if (typeof window !== "undefined") window.lxSaveSalonColumns = lxSaveSalonColumns;

// 2026-10-15 : CONTROLE COMMUN DE TOUTE ECRITURE (meme regle que lxSaveSalonColumns).
// `requete` = requete Supabase (avec .select(...) si une ligne est attendue) ou promesse.
// Echec = erreur renvoyee, erreur reseau, ou 0 ligne touchee alors qu'une ligne etait attendue
// (refus silencieux : droits, trigger, ligne absente). L'utilisateur est TOUJOURS prevenu
// (« Non enregistre — ... Reessayez »), sauf opts.silencieux. Retourne {ok, error, data}.
// opts.lignes === false : pas de controle du nombre de lignes (insert sans .select, RPC...).
function _lxEcritureAlerte(libelle, err, opts) {
  var m = String((err && err.message) || "erreur inconnue");
  console.warn("[ecriture] " + libelle + " :", m);
  try { if (typeof saveAuditEntry === "function" && !(opts && opts.sansJournal)) saveAuditEntry("DB_ERROR", JSON.stringify({ fn: "lxEcritureVerifiee", quoi: String(libelle).slice(0, 120), msg: m.slice(0, 200) })); } catch (_eA) {}
  if (opts && opts.silencieux) return;
  var txt = "⚠️ Non enregistré — " + libelle + " : " + m + ". Réessayez" + (opts && opts.suite ? " " + opts.suite : "") + ".";
  try {
    if (opts && opts.toast && typeof toast === "function") toast(txt, "error");
    else if (typeof showAlert === "function") showAlert(txt, "warning");
    else if (typeof toast === "function") toast(txt, "error");
  } catch (_e) {}
}
function lxEcritureVerifiee(requete, libelle, opts) {
  opts = opts || {};
  try {
    if (!_sb || !_salonId) { var e0 = { message: "pas de connexion au serveur" }; _lxEcritureAlerte(libelle, e0, opts); return Promise.resolve({ ok:false, error:e0 }); }
    return Promise.resolve(requete).then(function (res) {
      var err = res && res.error;
      if (!err && opts.lignes !== false && (!res || !Array.isArray(res.data) || !res.data.length)) err = { message: "aucune modification acceptée par le serveur" };
      if (!err) return { ok:true, error:null, data:(res ? res.data : null) };
      _lxEcritureAlerte(libelle, err, opts);
      return { ok:false, error:err };
    }, function (e) {
      var err = { message: "problème de connexion" + (e && e.message ? " (" + e.message + ")" : "") };
      _lxEcritureAlerte(libelle, err, opts);
      return { ok:false, error:err };
    });
  } catch (e) { var e1 = { message: String((e && e.message) || e) }; _lxEcritureAlerte(libelle, e1, opts); return Promise.resolve({ ok:false, error:e1 }); }
}
if (typeof window !== "undefined") window.lxEcritureVerifiee = lxEcritureVerifiee;

// FIX 2026-10-07 : taux de TVA. Le chargement faisait `salon.taux_tva || 20`, et une
// trentaine d'endroits faisaient `lxTauxTVA()`. En JavaScript, 0 || 20
// vaut 20 : un salon en FRANCHISE DE TVA (taux 0, art. 293 B du CGI) se retrouvait
// donc a 20 % partout, y compris dans ses tickets scelles.
// Constate en production le 07/10 chez Delphinecoiff : les 5 premiers tickets portent
// 20 % de TVA et un montant de TVA, alors qu'elle n'en collecte aucune.
// Cette fonction distingue « taux absent » (-> 20 par defaut) de « taux a zero »
// (-> 0, valeur legitime). Elle doit etre utilisee PARTOUT a la place de `|| 20`.
if (typeof window !== "undefined" && typeof window.lxTauxTVA !== "function") {
  window.lxTauxTVA = function(){
    try{
      var t = (typeof SALON_CONFIG !== "undefined" && SALON_CONFIG) ? SALON_CONFIG.tauxTVA : null;
      if (t === null || t === undefined || t === "" || isNaN(Number(t))) return 20;
      return Number(t);
    }catch(_e){ return 20; }
  };
  window.lxTauxTVAProduits = function(){
    try{
      var t = (typeof SALON_CONFIG !== "undefined" && SALON_CONFIG) ? SALON_CONFIG.tvaProduits : null;
      if (t === null || t === undefined || t === "" || isNaN(Number(t))) return window.lxTauxTVA();
      return Number(t);
    }catch(_e){ return window.lxTauxTVA(); }
  };
}
async function loadSalonData() {
  if (!_sb || !_userId) { startOffline(); return; }
  try{

  // 1. Charger le salon
  var sRes;
  if (window._lxVueAdmin) {
    var _u = null; try { _u = (await _sb.auth.getUser()).data.user; } catch(_e) {}
    if (!_u || String(_u.email||"").toLowerCase() !== "support@luxyra.fr") { _lxVueAdminStop("Connecte-toi d'abord au panneau admin (support@luxyra.fr) dans ce navigateur, puis rouvre la vue depuis la fiche du salon."); return; }
    sRes = await _sb.from("salons").select("*").eq("id", window._lxVueAdmin).limit(1);
    if (sRes.error || !sRes.data || !sRes.data.length) { _lxVueAdminStop("Salon introuvable."); return; }
  } else {
    // 2026-10-12 : un même compte peut avoir un établissement fermé (archives) puis un nouveau :
    // on ouvre l'établissement en activité ; les archives d'un fermé s'ouvrent via « luxyra_archive_salon ».
    var _arcId = null; try { _arcId = sessionStorage.getItem("luxyra_archive_salon"); } catch(_e) {}
    if (_arcId) sRes = await _sb.from("salons").select("*").eq("user_id", _userId).eq("id", _arcId).limit(1);
    if (!_arcId || !sRes || sRes.error || !sRes.data || !sRes.data.length)
      sRes = await _sb.from("salons").select("*").eq("user_id", _userId).order("ferme_le", { ascending: true, nullsFirst: true }).order("created_at", { ascending: false }).limit(1);
    try { var _autres = await _sb.from("salons").select("id,nom,ferme_le").eq("user_id", _userId).not("ferme_le", "is", null);
      window._lxSalonsFermes = (_autres.data || []); } catch(_e) { window._lxSalonsFermes = []; }
  }
  if (sRes.error || !sRes.data || sRes.data.length === 0) {
    // Session existe mais aucun salon lié au user → on déconnecte proprement
    // (évite le "zombie state" où l'UI se charge sans données)
    console.warn("[loadSalonData] Aucun salon trouvé pour user_id="+_userId+", déconnexion");
    try{ await _sb.auth.signOut({ scope: "local" }); }catch(_){} // 2026-10-14 : cet appareil seulement
    _userId = null;
    _salonId = null;
    window._salonId = null;
    showLoginScreen();
    var _msgNoSalon = (sRes && sRes.error) ? "Connexion au serveur impossible pour le moment. Vérifiez internet puis reconnectez-vous." : "Aucun salon lié à ce compte. Reconnectez-vous avec le bon email."; // 2026-10-14
    setTimeout(function(){ showLoginError && showLoginError(_msgNoSalon); }, 150);
    return;
  }

  var salon = sRes.data[0];
  window._lxChargementEnCours = true; // 2026-10-07 : chargement en cours (voir _lxListeChargee)
  _salonId = salon.id;
  window._salonId = salon.id; // expose explicitement pour app.html (startCheckout, etc.)
  _isOnline = true;
  // 2026-10-11 (NF525) : poste de caisse de cet appareil connu dès la connexion (avant tout encaissement)
  setTimeout(function(){ try { if (typeof window.lxPosteInit === "function" && !window.LX_POSTE) window.lxPosteInit(); } catch(_eP){} }, 1500);

  // Flush queue d'erreurs JS pré-login (hook window.onerror — voir app.html)
  try { if (typeof window._lxFlushErrorQueue === "function") window._lxFlushErrorQueue(); } catch(_){}

  // 2026-10-14 audit : la vérification de la file de secours (WAL) est programmée APRÈS le contrôle du statut
  // de l'abonnement (plus bas) : un établissement suspendu / en mode archives ne rejoue plus rien.

  // Minimum config pour les écrans de blocage
  SALON_CONFIG.nom = salon.nom || "Mon Salon";
  SALON_CONFIG.email = salon.email || "";
  SALON_CONFIG.plan = salon.plan || "essential";

  // === CACHE INDEXEDDB : hydratation anticipée pour démarrage instantané ===
  // Si on a un snapshot du salon dans IndexedDB, on l'utilise pour pré-charger
  // les variables globales AVANT le fetch full. Ça permet à app.html de rendre
  // le dashboard immédiatement (~50ms) si la callback _earlyRenderFromCache est
  // définie. Le fetch full continue en background et écrase les data avec les
  // valeurs fraîches à la fin → re-render automatique via go("home") final.
  // Aucune casse : si le cache est invalide ou IndexedDB échoue, fallback flow normal.
  window._cacheHydrated = false;
  if (window.LX_CACHE_ENABLED && (salon.status !== "suspended" && salon.status !== "cancelled")) {
    try {
      var cachedSnap = await readCacheSnapshot(_salonId);
      if (cachedSnap && _hydrateFromSnapshot(cachedSnap)) {
        window._cacheHydrated = true;
        console.log("[cache] hydrated from IndexedDB cache (cached_at: "+cachedSnap.cached_at+")");
        // Callback côté app.html pour render anticipé. Si non définie, on continue
        // sans render anticipé — le fetch normal fait le go("home") à la fin.
        if (typeof window._earlyRenderFromCache === "function") {
          try { window._earlyRenderFromCache(); } catch(e){ console.warn("[cache] earlyRender threw:", e); }
        }
      }
    } catch(e){ console.warn("[cache] hydration skipped:", e?.message || e); }
  }

  // Vérifier statut abonnement
  window._lxSalonSuspendu = (salon.status === "suspended" || salon.status === "cancelled"); // 2026-10-14 audit : écritures et rejeux bloqués
  if (salon.status === "suspended" || salon.status === "cancelled") {
    // Mode Archives : si l'utilisateur a explicitement choisi d'accéder à ses
    // documents comptables (lecture seule), on continue le chargement normal mais
    // avec le flag _archiveMode qui désactive toutes les écritures côté UI.
    // Le flag est posé par showSuspendedScreen → bouton "Accéder à mes archives"
    // (sessionStorage = nettoyé à fermeture onglet, pas localStorage).
    // 2026-10-12 : en vue admin, le stockage est en mémoire (perdu au rechargement) -> archives directement
    if ((sessionStorage.getItem("luxyra_archive_mode") === "1" || window._lxVueAdmin) && salon.status === "cancelled") {
      window._archiveMode = true;
      window._archiveSalon = salon;
      // Continue le chargement normal — le bandeau + le verrouillage des routes
      // sont injectés par enterArchiveMode() après que l'app soit montée.
    } else {
      showSuspendedScreen(salon.status, salon);
      return;
    }
  }
  // WAL : vérifier s'il y a des actions non synchronisées et proposer récupération
  // (filet 15/05/2026 — voir bloc WAL en haut de ce fichier). 2026-10-14 audit : après le contrôle du statut ;
  // _walCheck ne fait rien en mode archives / établissement suspendu.
  setTimeout(function(){ try{ _walCheck(); }catch(_){} }, 2000);

  // Vérifier si plan offert (gratuit)
  if(salon.is_free){
    // Check if free plan has expired
    if(salon.free_until){
      var freeEnd=new Date(salon.free_until);
      if(new Date()>freeEnd){
        // Free plan expired, revert to trial
        salon.is_free=false;
        // FIX 2026-08-04 : requete PARESSEUSE -> sans .then()/await le client Supabase ne
    // l'envoie JAMAIS. Le salon restait "offert" a vie en base apres expiration du plan.
    _sb.from("salons").update({is_free:false}).eq("id",salon.id).then(function(){},function(){});
      }
    }
    // If still free, skip trial/payment checks
    if(salon.is_free){
      window._trialDaysLeft=null;
      window._trialEnd=null;
    }
  }

  // Handle Stripe checkout return BEFORE trial check
  // FIX W2: Do NOT update DB from client (anyone can fake ?checkout=success)
  // Only skip the trial-block UI temporarily — the webhook will update the DB
  var _urlParams = new URLSearchParams(window.location.search);
  if(_urlParams.get("checkout") === "success"){
    var _checkoutPlan = _urlParams.get("plan") || "pro";
    // Temporarily treat as active in memory (UI only, NOT saved to DB)
    salon.plan = _checkoutPlan;
    salon.status = "active";
    window._trialDaysLeft = null;
    window._trialEnd = null;
    // DO NOT write to DB — webhook is the only trusted source
    // Old vulnerable code removed: _sb.from("salons").update({plan, status}).eq("id", salon.id)
  }

  // 2026-10-11 (NF525, mode école) : mode de caisse de l'établissement, fixé par le serveur
  window.LX_MODE_CAISSE = (salon.mode_caisse === "test") ? "test" : "reel";
  window.LX_PARR_MASQUE = salon.parr_bandeau_masque === true; // bandeau parrainage fermé définitivement (tous appareils)
  // Vérifier expiration essai (sauf plan offert)
  if(!salon.is_free && salon.status === "trial" && salon.trial_end) {
    var now = new Date();
    var end = new Date(salon.trial_end);
    var daysLeft = Math.ceil((end - now) / 86400000);
    window._trialDaysLeft = daysLeft;
    window._trialEnd = salon.trial_end;
    // Blocking is handled in initApp() via isTrialExpired()
    // Don't return here — initApp must run for Stripe checkout return to work
  } else {
    window._trialDaysLeft = null;
    window._trialEnd = null;
  }

  // 2. Mapper vers SALON_CONFIG (format existant de l'app)
  SALON_CONFIG.nom = salon.nom || "Mon Salon";
  SALON_CONFIG.sousTitre = salon.sous_titre || "";
  SALON_CONFIG.logo = salon.logo || "";
  // 2026-10-13 : logo trop lourd (photo brute de plusieurs Mo) -> réduit à 512 px une fois et réenregistré
  try { if (String(SALON_CONFIG.logo).length > 300000 && /^data:image\//.test(SALON_CONFIG.logo)) { setTimeout(function () {
    if (typeof window.lxImgReduire !== "function") return;
    var _orig = SALON_CONFIG.logo;
    window.lxImgReduire(_orig, 512, 0.85, function (v) { if (!v || v.length >= _orig.length || SALON_CONFIG.logo !== _orig) return;
      SALON_CONFIG.logo = v; if (window.SALON) window.SALON.logo = v;
      if (typeof lxSaveSalonColumns === "function") lxSaveSalonColumns({ logo: v });
    }, true);
  }, 6000); } } catch (_eL) {}
  SALON_CONFIG.adresse = salon.adresse || "";
  SALON_CONFIG.cp = salon.cp || "";
  SALON_CONFIG.ville = salon.ville || "";
  SALON_CONFIG.tel = salon.tel || "";
  SALON_CONFIG.email = salon.email || "";
  SALON_CONFIG.siteWeb = salon.site_web || "";
  SALON_CONFIG.noteTicket = salon.note_ticket || "";  // 2026-10-09 : note en bas des tickets
  SALON_CONFIG.siret = salon.siret || "";
  SALON_CONFIG.tva = salon.tva || "";
  SALON_CONFIG.couleurPrimaire = salon.couleur_primaire || "#c8a84e";
  SALON_CONFIG.couleurSecondaire = salon.couleur_secondaire || "#1a1a1a";
  SALON_CONFIG.subdomain = salon.subdomain || "";
  // FIX 2026-10-07 : `|| 20` ecrasait un taux a 0 (franchise de TVA). Voir lxTauxTVA().
  SALON_CONFIG.tauxTVA = (salon.taux_tva !== null && salon.taux_tva !== undefined && salon.taux_tva !== "") ? Number(salon.taux_tva) : 20;
  SALON_CONFIG.tvaProduits = (salon.taux_tva_produits != null) ? Number(salon.taux_tva_produits) : SALON_CONFIG.tauxTVA;
  // 2026-10-17 audit réglages (#11) : valeur brute de la colonne (null = « suit le taux des prestations »), pour que
  // saveTVA mette à jour le taux produits en mémoire EXACTEMENT comme le ferait ce chargement.
  SALON_CONFIG.tvaProduitsColonne = (salon.taux_tva_produits != null && isFinite(Number(salon.taux_tva_produits))) ? Number(salon.taux_tva_produits) : null;
  // 2026-10-11 : franchise en base (TVA 0 %) -> jamais de TVA sur les produits non plus
  if (Number(SALON_CONFIG.tauxTVA) === 0) SALON_CONFIG.tvaProduits = 0;
  // 2026-10-11 : forme juridique (choisie à l'inscription) et mois de clôture de l'exercice comptable.
  SALON_CONFIG.formeJuridiqueCode = salon.forme_juridique || "";
  // 2026-10-29 (Luxyra 6.8.6) : mentions légales d'une société (factures, devis) — colonnes salons.rcs_ville / capital_social
  SALON_CONFIG.rcsVille = salon.rcs_ville || "";
  SALON_CONFIG.capitalSocial = (salon.capital_social != null && isFinite(Number(salon.capital_social))) ? Number(salon.capital_social) : null;
  SALON_CONFIG.exerciceFinMois = (Number(salon.exercice_fin_mois) >= 1 && Number(salon.exercice_fin_mois) <= 12) ? Number(salon.exercice_fin_mois) : 12;
  // 2026-10-10 : frais de déplacement enregistrés dans les colonnes (mini-site) quand la config de l'app n'en a
  // pas encore (la config, chargée plus loin, reste prioritaire). Frais à 0 = jamais réglés -> défauts inchangés.
  try {
    if (salon.mode_activite && salon.mode_activite !== "salon" && !SALON_CONFIG.domicile && ((Number(salon.frais_deplacement) || 0) > 0 || salon.frais_deplacement_type === "par_km")) {
      var _fd = Number(salon.frais_deplacement) || 0, _pk = salon.frais_deplacement_type === "par_km";
      SALON_CONFIG.domicile = { type: _pk ? "km" : (_fd > 0 ? "forfait" : "gratuit"), forfait: _pk ? 15 : (_fd || 15), prixKm: _pk ? _fd : 0.5, zone: Number(salon.zone_deplacement_km) || 20, gratuitKm: 0 };
    }
  } catch (_eDom) {}
  SALON_CONFIG.plan = salon.plan || "essential";
  SALON_CONFIG.metier = salon.metier || "coiffure";
  SALON_CONFIG.metiers = (Array.isArray(salon.metiers_autres) ? salon.metiers_autres : []).filter(function (m) { return m && m !== SALON_CONFIG.metier; }); // 2026-10-13 : autres métiers
  SALON_CONFIG.modeActivite = salon.mode_activite || "salon";
  SALON_CONFIG.zoneDeplacementKm = salon.zone_deplacement_km || 0;
  SALON_CONFIG.fraisDeplacement = salon.frais_deplacement || 0;
  if (salon.show_tva_ticket !== undefined) window.SHOW_TVA_TICKET = salon.show_tva_ticket;
  // SMS credits
  window.SMS_CREDITS = salon.sms_credits || 0;
  window.SMS_USED = salon.sms_used || 0;
  // Mode SMS : brevo (API payante) ou native (app companion Android)
  window.SMS_MODE = salon.sms_mode || 'brevo';
  window.SMS_NATIVE_DEVICE_ID = salon.sms_native_device_id || null;
  window.IS_FREE_PLAN = salon.is_free || false;
  window.FREE_UNTIL = salon.free_until || null;

  // Documents check (15 days after paid plan)
  SALON_CONFIG.docKbis = salon.documents_kbis || "";
  SALON_CONFIG.docId = salon.documents_id || "";
  SALON_CONFIG.docIdVerso = salon.documents_id_verso || ""; // 2026-10-14 : verso de la piece d'identite (ecrit mais jamais recharge)
  SALON_CONFIG.verif = salon.verification_status || "pending";

  // Stripe Connect status : nécessaire pour gater la feature acompte en ligne
  // ("active" = KYC complet, salon peut recevoir des paiements directs)
  SALON_CONFIG.stripeConnectStatus = salon.stripe_connect_status || "";
  SALON_CONFIG.stripeConnectId = salon.stripe_connect_id || "";
  // Toggle "Bons cadeaux en ligne" — vente publique de bons cadeaux via Stripe Checkout
  // Gated par Stripe Connect actif (sinon les fonds ne peuvent pas être encaissés)
  SALON_CONFIG.bonsCadeauxOnlineActif = salon.bons_cadeaux_online_actif === true;
  // Programme "100 Fondateurs" — badge visible dans Mon abonnement
  SALON_CONFIG.isFounder = salon.is_founder === true;
  SALON_CONFIG.founderNum = salon.founder_num ? Number(salon.founder_num) : null;
  SALON_CONFIG.founderAt = salon.founder_at || null;
  // Prix Pro affiché dans l'app = prix réellement facturé (CGV art. 5 bis) :
  // tarif Fondateur si le salon est déjà Pro Fondateur, ou s'il reste des places.
  try {
    window._lxProFondateur = (salon.is_founder === true && salon.plan === "pro");
    if (!window._lxProFondateur && salon.plan !== "pro") {
      _sb.rpc("founders_stats").then(function(r){
        var st = r && r.data && r.data[0];
        if (st && Number(st.remaining) > 0) { window._lxProFondateur = true; if (typeof lxRefreshPriceElements === "function") lxRefreshPriceElements(); }
      }, function(){});
    }
  } catch (_eF) {}
  var hasAllDocs = salon.documents_kbis && salon.documents_id;
  if (!salon.is_free && salon.status === "active" && salon.stripe_subscription_id && !hasAllDocs) {
    // 2026-10-10 : 15 jours à compter du 1er paiement d'abonnement (CGV art. 4), pas de l'inscription
    var subStart = salon.abonne_depuis || salon.contrat_accepted_at || salon.cgv_accepted_at || salon.created_at;
    if (subStart) {
      var daysSinceSub = Math.floor((new Date() - new Date(subStart)) / 86400000);
      window._docsMissing = true;
      window._docsDeadlineDays = Math.max(0, 15 - daysSinceSub);
      if (daysSinceSub > 15) {
        window._docsBlocked = true;
      }
    }
  }

  // SMS bonus v2 (2026-04) : l'ancien système +30 SMS/mois automatique a été
  // remplacé par un bonus one-shot de 150 SMS crédité par le worker Cloudflare
  // sur réception du 1er invoice.paid Pro en mode LIVE (anti-doublon via le
  // flag salons.welcome_sms_bonus_given). Voir luxyra-router-worker.js,
  // case "invoice.paid". Aucun crédit récurrent ici.
  /* 2026-10-07 : rien du stockage navigateur (autre compte possible) ne survit au chargement */ window.SMS_CONFIG=undefined; window.LX_VERROU_MIN=undefined; try{ if(typeof APP_BG!=="undefined") APP_BG="https://images.unsplash.com/photo-1560066984-138dadb4c035?w=800&q=80"; }catch(_eB){}
  if(salon.config_json){try{var cfg=typeof salon.config_json==="string"?JSON.parse(salon.config_json):salon.config_json;if(cfg.slot)SLOT=cfg.slot;if(cfg.slot_h)SLOT_H=cfg.slot_h;if(cfg.fidconf)window.FIDCONF=cfg.fidconf;if(cfg.pay_active)window.PAY_ACTIVE=cfg.pay_active;/* Restore CAISSE_DATA — robuste pour TOUS les salons (anciens et nouveaux) :
   1. cfg.caisse_data (nouveau format) → utilisé en priorité
   2. Champs racine legacy (coffreEsp/misesAuCoffre/mouvements/remisesBanque/retraits/pieces/fond_caisse)
      → migrés vers CAISSE_DATA automatiquement (compat. tous salons existants)
   3. Rien en DB → defaults {fond:200} construits ailleurs
   Auto-migration : la prochaine sauvegarde écrira en format caisse_data et nettoiera les
   champs racine orphelins. NF525 non concerné (tickets/clotures vivent dans leurs propres tables). */
if(!window.CAISSE_DATA) window.CAISSE_DATA = {};
if(cfg.caisse_data && typeof cfg.caisse_data === "object"){
  Object.keys(cfg.caisse_data).forEach(function(k){ window.CAISSE_DATA[k] = cfg.caisse_data[k]; });
}
if(typeof cfg.fond_caisse !== "undefined" && typeof window.CAISSE_DATA.fond === "undefined"){
  window.CAISSE_DATA.fond = cfg.fond_caisse;
}
["coffreEsp","coffreChq","misesAuCoffre","mouvements","remisesBanque","retraits","pieces"].forEach(function(k){
  if(typeof cfg[k] !== "undefined" && typeof window.CAISSE_DATA[k] === "undefined"){
    window.CAISSE_DATA[k] = cfg[k];
  }
});/* 2026-10-07 : delai de verrouillage PIN du salon */if(typeof cfg.verrouillage_min==="number"){window.LX_VERROU_MIN=cfg.verrouillage_min;}/* 2026-10-07 : config SMS = celle du salon, ou AUCUNE (l ecran SMS cree alors les reglages par defaut). Avant, une config lue au demarrage dans le stockage du navigateur (autre compte possible) restait en place. */if(cfg.sms_config&&typeof cfg.sms_config==="object"&&Object.keys(cfg.sms_config).length){window.SMS_CONFIG=cfg.sms_config;}else{window.SMS_CONFIG=undefined;}/* 2026-10-07 : fond d ecran charge ici aussi (avant : seulement apres coup, la valeur d un autre compte restait affichee/enregistrable) */try{if(typeof cfg.app_bg!=="undefined"&&typeof APP_BG!=="undefined"){APP_BG=cfg.app_bg||"";}}catch(_eBg){}if(cfg.prodcolors){window.PRODCOLORS=cfg.prodcolors;try{localStorage.setItem("_lx_prodcolors",JSON.stringify(cfg.prodcolors));}catch(e){}}if(cfg.svccolors){window.SVCCOLORS=cfg.svccolors;try{localStorage.setItem("_lx_svccolors",JSON.stringify(cfg.svccolors));}catch(e){}}if(cfg.validite_devis)SALON_CONFIG.validiteDevis=Number(cfg.validite_devis);if(Array.isArray(cfg.categories))window._cfgCategories=cfg.categories.slice();/* FIX 2026-10-07 : les familles de prestations sont stockees sous DEUX cles (categories_services/cats_svc et categories_forfaits/cats_forf), ecrites par des chemins differents, mais le chargement ne lisait QUE les premieres. Constate chez Delphinecoiff : cats_forf contenait ses 7 familles de forfaits, categories_forfaits etait un tableau VIDE -> ses familles disparaissaient a chaque ouverture, ce qu elle a signale au support. On prend desormais la liste NON VIDE, quelle que soit la cle. */window._cfgCatsSvc=(function(){var a=Array.isArray(cfg.categories_services)?cfg.categories_services:null;var b=Array.isArray(cfg.cats_svc)?cfg.cats_svc:null;if(a&&a.length)return a.slice(); if(b&&b.length)return b.slice(); return (a||b||null)?[]:undefined;})();window._cfgCatsForf=(function(){var a=Array.isArray(cfg.categories_forfaits)?cfg.categories_forfaits:null;var b=Array.isArray(cfg.cats_forf)?cfg.cats_forf:null;if(a&&a.length)return a.slice(); if(b&&b.length)return b.slice(); return (a||b||null)?[]:undefined;})();if(typeof cfg.facebookUrl==="string")SALON_CONFIG.facebookUrl=cfg.facebookUrl;if(typeof cfg.instagramUrl==="string")SALON_CONFIG.instagramUrl=cfg.instagramUrl;if(typeof cfg.tiktokUrl==="string")SALON_CONFIG.tiktokUrl=cfg.tiktokUrl;/* FIX 2026-08-04 : `domicile` (zone couverte, gratuit jusqu'a X km, type de tarif, forfait, prix/km) etait ECRIT dans config_json par saveSalonConfig mais JAMAIS RELU -> tous les reglages "deplacement a domicile" revenaient aux valeurs par defaut {type:"forfait",forfait:15,prixKm:0.5,zone:20,gratuitKm:5} a chaque rechargement. */if(cfg.domicile&&typeof cfg.domicile==="object")SALON_CONFIG.domicile=cfg.domicile;}catch(e){}}
  // Defaults if not loaded from cfg
  if(!SALON_CONFIG.validiteDevis) SALON_CONFIG.validiteDevis = 30;

  // ============================================================
  // 2.5 — Pré-load PENDING_TK + DEVIS EN PRIORITÉ (avant tout
  // chargement potentiellement faillible). Garanti d'être tenté
  // même si une étape suivante throw, parce qu'elle est elle-même
  // wrappée et qu'on défere les autres loads dans des try/catch
  // individuels juste après.
  // ============================================================
  window.PENDING_TK = window.PENDING_TK || [];
  window.DEVIS = window.DEVIS || [];
  await loadPendingAndDevis();

  // 3. Charger collaborateurs → T[]
  try {
    var tRes = await _sb.from("collaborateurs").select("*").eq("salon_id", _salonId).order("id");
    if (tRes.data && !tRes.error) {
      window._lxTableOk = window._lxTableOk || {}; window._lxTableOk.collaborateurs = true;
      T = tRes.data.map(lxMapCollabRow); // 2026-10-14 audit : mapper unique (partagé avec le rafraîchissement)
      window._lxCollabIdsServeur = {}; tRes.data.forEach(function(c){ window._lxCollabIdsServeur[c.id] = 1; });
    }
  } catch(e) { console.warn("[loadSalonData] collaborateurs skipped", e); }

  // 4. Charger services → SVC[]
  try {
    // Tri par catégorie puis par ordre personnalisé (NULL en dernier) puis nom
    var svcRes = await _sb.from("services").select("*").eq("salon_id", _salonId)
      .order("categorie", {ascending: true})
      .order("ordre", {ascending: true, nullsFirst: false})
      .order("nom", {ascending: true});
    if (svcRes.data && !svcRes.error) {
      window._lxTableOk = window._lxTableOk || {}; window._lxTableOk.services = true;
      SVC = svcRes.data.map(function(s) {
        return { id: s.id, n: s.nom, p: Number(s.prix), cat: s.categorie, ordre: s.ordre, phases: s.phases || [], showSite: s.show_site !== false, bookOnline: s.book_online !== false, catGenre: s.cat_genre || null, devis: s.prix_sur_devis === true,
          apartir: s.prix_a_partir_de === true && s.prix_sur_devis !== true }; // 2026-10-15 : prix = minimum (« à partir de »)
      });
      // 2026-10-15 : colonne prix_a_partir_de présente en base ? (SQL apartir.sql) — sinon on ne l'écrit pas
      try { if (svcRes.data.length) window._lxColsCat.svcApd = Object.prototype.hasOwnProperty.call(svcRes.data[0], "prix_a_partir_de"); } catch(_eC) {}
      try { _lxCatSigReset("services", SVC); } catch(_eSig) {} // 2026-10-14 : etat « en base » pour n'ecrire que les lignes modifiees
      // Recalculer CATS — si aucun service encore, applique les defaultCats
      // du métier configuré au lieu de garder les catégories coiffure
      // hardcodées (sinon un nouveau salon "esthétique" verrait des
      // "Coupe / Coloration" sans rapport avec son activité).
      // SOURCE DE VÉRITÉ : 2 LISTES INDÉPENDANTES (CATS_SVC + CATS_FORF).
      // Une famille de services est SÉPARÉE d'une famille de forfaits
      // même si elles ont le même nom. CATS = union pour rétro-compat
      // mais les chips et la logique de suppression utilisent les deux
      // listes séparément.
      var derivedSvc = {}, derivedForf = {};
      SVC.forEach(function(s) {
        if (!s.cat) return;
        var multi = s.phases && s.phases.length > 1;
        if (multi) derivedForf[s.cat] = true;
        else derivedSvc[s.cat] = true;
      });
      var derSvcArr = Object.keys(derivedSvc);
      var derForfArr = Object.keys(derivedForf);

      // CATS_SVC : depuis config si présent, sinon dérivé
      if (Array.isArray(window._cfgCatsSvc)) {
        window.CATS_SVC = window._cfgCatsSvc.slice();
        // safety net : ajoute orphelins
        derSvcArr.forEach(function(c){ if(window.CATS_SVC.indexOf(c)<0) window.CATS_SVC.push(c); });
      } else if (Array.isArray(window._cfgCategories)) {
        // Migration : ancienne config "categories" non typée. On copie
        // TOUTES les anciennes familles dans CATS_SVC pour que rien ne
        // disparaisse au passage à la nouvelle structure. L'utilisateur
        // pourra supprimer ce qu'il veut ensuite (les listes sont
        // indépendantes après la migration).
        window.CATS_SVC = window._cfgCategories.slice();
        derSvcArr.forEach(function(c){ if(window.CATS_SVC.indexOf(c)<0) window.CATS_SVC.push(c); });
      } else {
        window.CATS_SVC = derSvcArr;
      }

      // CATS_FORF : symétrique — migration garde aussi tout
      if (Array.isArray(window._cfgCatsForf)) {
        window.CATS_FORF = window._cfgCatsForf.slice();
        derForfArr.forEach(function(c){ if(window.CATS_FORF.indexOf(c)<0) window.CATS_FORF.push(c); });
      } else if (Array.isArray(window._cfgCategories)) {
        window.CATS_FORF = window._cfgCategories.slice();
        derForfArr.forEach(function(c){ if(window.CATS_FORF.indexOf(c)<0) window.CATS_FORF.push(c); });
      } else {
        window.CATS_FORF = derForfArr;
      }

      // RÉPARATION : v15 a filtré les familles présentes dans l'ancien
      // cfg.categories en ne gardant que celles avec un contenu détecté
      // de leur tab. Résultat : une famille avec uniquement des forfaits
      // a disparu de Services (et inversement). On restaure : toute
      // famille présente dans cfg.categories doit être dans LES DEUX
      // listes. L'utilisateur peut ensuite supprimer de l'un ou l'autre.
      // FIX 2026-10-07 : reparation limitee a la MIGRATION (aucune liste typee en base).
      // Avant, elle s'appliquait a chaque chargement : l'ancienne cle "categories" (encore
      // reecrite par d'anciens chemins) ressuscitait les familles supprimees et recopiait
      // chaque famille de prestations dans les forfaits (et inversement).
      if (Array.isArray(window._cfgCategories) && window._cfgCatsSvc === undefined && window._cfgCatsForf === undefined) {
        window._cfgCategories.forEach(function(c){
          if (!c) return;
          if (window.CATS_SVC.indexOf(c) < 0) window.CATS_SVC.push(c);
          if (window.CATS_FORF.indexOf(c) < 0) window.CATS_FORF.push(c);
        });
      }

      // Salon vierge ? Applique les defaultCats du métier en SERVICES
      // 2026-10-07 : suggestions du metier UNIQUEMENT pour un salon qui n'a jamais enregistre
      // de familles. Un salon qui a supprime toutes les siennes ne les voit plus revenir.
      if (!window.CATS_SVC.length && !window.CATS_FORF.length
          && window._cfgCatsSvc === undefined && window._cfgCatsForf === undefined && !Array.isArray(window._cfgCategories)
          && typeof METIER_CONFIG !== "undefined" && SALON_CONFIG.metier && METIER_CONFIG[SALON_CONFIG.metier]) {
        window.CATS_SVC = METIER_CONFIG[SALON_CONFIG.metier].defaultCats.slice();
      }

      // CATS = union (rétro-compat avec code qui itère encore sur CATS)
      var union = {};
      window.CATS_SVC.forEach(function(c){ union[c]=true; });
      window.CATS_FORF.forEach(function(c){ union[c]=true; });
      CATS = Object.keys(union);
    }
  } catch(e) { console.warn("[loadSalonData] services skipped", e); }

  // 5. Charger clients → CL[]
  try {
    // Limit 5000 clients = filet de sécurité scalabilité (gros salon = 2000-3000 clients
    // actifs+inactifs). Au-delà, le user peut chercher via le moteur de recherche
    // qui fera un fetch ciblé sur le serveur.
    var clRes = await _sb.from("clients").select("*").eq("salon_id", _salonId).order("nom").limit(100000);
    if (clRes.data) {
      // MAPPER UNIQUE partage avec reloadFromSupabase("clients") (voir lxMapClientRow).
      // 2026-10-13 : fiches « fusionnées » (doublon dont des tickets clôturés ne peuvent pas bouger) :
      // cachées, et leurs tickets / RDV affichés sur la fiche gardée (correspondance en mémoire, lecture seule).
      lxMajFusions(clRes.data);
      // 2026-10-14 audit : fiches anonymisées (effacement RGPD, rgpd_anonymise_le) écartées comme les fiches fusionnées
      CL = clRes.data.filter(function(c){ return !c.fusionne_dans && !c.rgpd_anonymise_le; }).map(lxMapClientRow);
    }
  } catch(e) { console.warn("[loadSalonData] clients skipped", e); }

  // 5b. Sync fidelite points from fidelite_client (source of truth)
  try {
    var fidRes = await _sb.from("fidelite_client").select("client_luxyra_id,points").eq("salon_id", _salonId);
    if (fidRes.data) {
      fidRes.data.forEach(function(f) {
        for (var ci = 0; ci < CL.length; ci++) {
          if (CL[ci].em && CL[ci].em === f.client_luxyra_id) {
            CL[ci].fid = f.points || 0;
          }
        }
      });
    }
  } catch(e) {}

  // 6. Charger rendez-vous/tickets → AP[]
  try {
    var apRes = await _sb.from("appointments").select("*").eq("salon_id", _salonId).order("date_rdv", { ascending: false }).limit(100000);
    if (apRes.data) {
      // Mapping DB->AP : MAPPER UNIQUE partage avec reloadFromSupabase (voir lxMapApptRow).
      AP = apRes.data.filter(function (r) { return !lxApptAnnuleSansTicket(r); }).map(lxMapApptRow); // 2026-10-14 audit : RDV annulés non encaissés exclus
      try { apRes.data.forEach(function(a){ _lxApVu(a.id); }); } catch(_eVu) {} // 2026-10-14 audit : vus en base (détection des suppressions)
      // FIX 2026-05-12 : tri explicite par tkNum DESC pour récupérer le hash du
      // DERNIER ticket de la chaîne. Sans tri, doneH[0] dépendait de l'ordre DB
      // (date_rdv DESC + ordre interne aléatoire dans la même date) → chaîne brisée
      // si la dernière entrée d'AP n'était pas le ticket de tkNum max.
      var doneH = AP.filter(function(a) { return a.hash; })
                    .sort(function(a,b){ return (b.tkNum||0) - (a.tkNum||0); });
      if (doneH.length) _lastTicketHash = doneH[0].hash || "00000000";
      var maxTkN=0;AP.forEach(function(a){if(a.tkNum&&a.tkNum>maxTkN)maxTkN=a.tkNum;});if(maxTkN>0)tkN=maxTkN;
    }
  } catch(e) { console.warn("[loadSalonData] appointments skipped", e); }

  // 6b. Charger RDV en ligne → window.RDV_ONLINE[]
  try {
  var today = new Date().toISOString().slice(0,10);
  // Limit 500 = filet sécurité. Les RDV online cancellés/done/refused vieux n'ont
  // pas besoin d'être en mémoire. Si plus tard nécessaire, lazy load via fetch ciblé.
  var roRes = await lxChargerRdvOnline();
  if (roRes.data) {
    // MAPPER UNIQUE partage avec app.html (voir lxMapRdvOnlineRow).
    window.RDV_ONLINE = roRes.data.map(lxMapRdvOnlineRow);
    // FIX 2026-05-27 (v2) : la creation des fiches manquantes pour les clients en ligne est
    // DEPORTEE hors du demarrage (un await en boucle ici bloquait l'ecran de chargement).
    // C'est le rafraichissement periodique _lxEnsureFichesForOnlineAppts (non bloquant) qui s'en charge.
    // Merge pending+confirmed into AP for planning display
    window.RDV_ONLINE.forEach(function(r) {
      if (r.status === "pending" || r.status === "confirmed") {
        // Check if already in AP (avoid duplicates)
        // FIX 2026-07-13 : garde-fou d'idempotence renforce (onlineId OU id "online_<uuid>")
        // -> 1 reservation en ligne = 1 SEULE entree dans AP, quel que soit l'etat de depart
        // (AP hydrate depuis le snapshot IndexedDB, entree sans onlineId, etc.).
        var exists = false, _exIdx = -1, _apId = "online_" + r.id;
        for (var i = 0; i < AP.length; i++) {
          if (AP[i] && (AP[i].onlineId === r.id || String(AP[i].id || "") === _apId)) { exists = true; _exIdx = i; break; }
        }
        if (exists && _exIdx >= 0 && !AP[_exIdx].onlineId) AP[_exIdx].onlineId = r.id;
        // FIX 2026-05-27 : entree deja presente (restauree depuis snapshot/cache) mais non reliee
        // a une fiche -> on tente de la relier maintenant (CL est charge a ce stade).
        if (exists && _exIdx >= 0 && !AP[_exIdx].cId) {
          var _rid0 = (typeof _lxResolveClientId === "function") ? _lxResolveClientId(r) : null;
          if (_rid0) AP[_exIdx].cId = _rid0;
        }
        if (!exists) {
          var dur = r.duree || 60;
          // Get real phases from the service definition
          var realSvc = null;
          for (var si = 0; si < SVC.length; si++) { if (SVC[si].id === r.svcId) { realSvc = SVC[si]; break; } }
          var phases = realSvc && realSvc.phases && realSvc.phases.length > 0 ? realSvc.phases : [{t:"w", d: dur, l: r.svcNom}];
          // 2026-10-11 : RDV modifié par l'établissement (forfait changé, prestation remplacée/ajoutée,
          // durée d'une phase) -> on reprend SON contenu, pas celui du catalogue.
          var _se = r.salonEdit && typeof r.salonEdit === "object" ? r.salonEdit : null;
          if (_se && Array.isArray(_se.phases) && _se.phases.length) phases = JSON.parse(JSON.stringify(_se.phases));
          // Items : si multi-prestation (r.items contient plusieurs entrées), on stocke
          // tout. Sinon on laisse VIDE (le main service est déjà dans a.sId/a.pr).
          // Important : ne pas pré-remplir avec un duplicat du main, sinon mD(id) à
          // l'encaissement crée 2 lignes (cf. fix 2026-05).
          var aptItems = [];
          if (Array.isArray(r.items) && r.items.length > 1) {
            aptItems = r.items.map(function(it){
              return {
                sId: it.sId || it.service_id || null,
                name: it.name || it.svcNom || "Prestation",
                price: Number(it.price || it.svcPrix || 0),
                qty: Number(it.qty || 1),
                remise: Number(it.remise || 0)
              };
            });
          }
          if (_se && Array.isArray(_se.items)) aptItems = JSON.parse(JSON.stringify(_se.items));
          // FIX 2026-07-13 : "SANS PREFERENCE" (collaborateur_id NULL). Avant, on poussait
          // `stId: r.collabId` VERBATIM => stId=null => AUCUNE colonne dans la grille du
          // planning => le RDV etait INVISIBLE apres tout rechargement de l'app (la logique
          // d'auto-assignation n'existait que dans _lxOnlineToAP, cote poll 30s, pour un RDV
          // NOUVEAU). On utilise maintenant le MEME resolveur que le poll (app.html).
          // Affichage uniquement : rien n'est ecrit dans rdv_online ici.
          var _oStId = r.collabId, _oNeed = false;
          if (!_oStId && typeof window._lxResolveOnlineStId === "function") {
            try {
              var _oRes = window._lxResolveOnlineStId(r.date, r.heure, dur, null);
              if (_oRes && _oRes.ok && _oRes.stId != null) { _oStId = _oRes.stId; _oNeed = !!_oRes.needAssign; }
            } catch (_eo) {}
          }
          AP.push({
            id: "online_" + r.id,
            onlineId: r.id,
            cId: (typeof _lxResolveClientId === "function" ? _lxResolveClientId(r) : null),
            sId: r.svcId,
            stId: _oStId,
            date: r.date,
            time: r.heure,
            pr: r.svcPrix,
            st: r.status === "confirmed" ? "conf" : "conf",
            items: aptItems,
            comment: "RDV EN LIGNE - " + r.nom + (r.prenom ? " " + r.prenom : "") + " - " + r.tel + (r.message ? " - " + r.message : "") + (_oNeed ? " \u2014 SANS PR\u00c9F\u00c9RENCE (\u00e0 assigner)" : ""),
            aPhases: phases,
            isOnline: true,
            onlineStatus: r.status,
            clientName: r.nom + (r.prenom ? " " + r.prenom : "")
          });
          try { if (typeof window._lxApOnlineEnrichir === "function") window._lxApOnlineEnrichir(AP[AP.length - 1], r); } catch (_eEn) {}
        }
      }
    });
    console.log("Luxyra: " + window.RDV_ONLINE.length + " RDV en ligne chargés");
  } else {
    window.RDV_ONLINE = [];
  }
  } catch(e) { console.warn("[loadSalonData] rdv_online skipped", e); window.RDV_ONLINE = window.RDV_ONLINE || []; }

  // 7. Charger produits → PRODS[]
  try {
  var prRes = await _sb.from("produits").select("*").eq("salon_id", _salonId).order("nom");
  if (prRes.data) {
    PRODS = prRes.data.map(lxMapProduitRow);
    var pcatSet = {};
    PRODS.forEach(function(p) { if (p.cat) pcatSet[p.cat] = true; });
    PCATS = Object.keys(pcatSet);
    // 2026-10-17 audit réglages (#69) : familles créées sans produit (config_json.pcats)
    try { if (typeof _lxPcatsFusion === "function") _lxPcatsFusion(); } catch(_ePc) {}
  }
  } catch(e) { console.warn("[loadSalonData] produits skipped", e); }

  // 7b. Charger fournisseurs → FOURNISSEURS[]
  window.FOURNISSEURS = [];
  try {
    var fRes = await _sb.from("fournisseurs").select("*").eq("salon_id", _salonId).order("nom");
    if (fRes.data) {
      window.FOURNISSEURS = fRes.data.map(function(f) {
        return { id: f.id, nom: f.nom, email: f.email || "", tel: f.telephone || "",
                 representant: f.representant || "", delai: f.delai_livraison || 7, notes: f.notes || "" };
      });
    }
  } catch(e) { console.log("[FOURNISSEURS] Skip:", e.message); }

  // 8. Charger cartes cadeaux → GC[]
  try {
  var gcRes = await _sb.from("cartes_cadeaux").select("*").eq("salon_id", _salonId).order("date_creation", { ascending: false });
  if (gcRes.data) {
    GC = gcRes.data.map(function(g) {
      return {
        id: g.id, val: Number(g.valeur), from: g.de, to: g.pour, msg: g.message,
        cr: g.date_creation, exp: g.date_expiration,
        used: Number(g.utilise), st: g.status, code: g.code, rem: Number(g.restant),
        scope: g.scope || "tout",
        gcNum: g.gc_num || null,
        payMethod: g.pay_method || null,
        isOffert: g.is_offert || false,
        ht: Number(g.ht) || 0,
        tva: Number(g.tva) || 0,
        tvaRate: (_lxBonUsageLigne(g) === "BUM") ? 0 : (Number(g.tva_rate) || 0.20), // 2026-10-28 : bon à usage multiple = sans TVA à la vente
        usageTva: _lxBonUsageLigne(g),          // 2026-10-28 (v6.7.0) : BUU / BUM figé à la création (null = bon antérieur)
        qualifTva: _lxBonQualifLigne(g),
        history: g.history || [],
        tkNum: g.tk_num || null,
        themeId: g.theme_id || null,   // Style choisi par l'acheteur (bons en ligne)
        source: g.source || null,      // "web" = vente en ligne, sinon caisse
        buyerEmail: g.buyer_email || null,
        buyerPhone: g.buyer_phone || null,
        paymentStatus: g.payment_status || null, // 2026-10-14 audit : bon en ligne non payé (« pending ») jamais utilisable
        // Marque le bon comme deja present en base : saveGiftCard n'ecrira alors plus
        // son solde depuis la memoire (voir le correctif du 31/08).
        _dejaEnBase: true
      };
    });
  }
  } catch(e) { console.warn("[loadSalonData] cartes_cadeaux skipped", e); }

  // 8.5. Charger tickets DB → window.TICKETS_DB[] (pour historique NF525 safe)
  //       Les tickets restent dans AP[] pour l'UI existante, window.TICKETS_DB
  //       sert de référence pour l'historique + réimpression fidèle via raw_data.
  try {
    var tkRes = await _sb.from("tickets").select("*")
      .eq("salon_id", _salonId)
      .order("num", { ascending: false })
      .limit(500);
    if (tkRes.data) {
      window.TICKETS_DB = tkRes.data.map(function(t) {
        var raw = (t.raw_data && typeof t.raw_data === "object") ? t.raw_data : {};
        return Object.assign({}, raw, {
          dbId: t.id, num: t.num, date: t.date_ticket,
          time: (t.heure_ticket || "").toString().slice(0,5),
          ts: t.ts_created,
          cId: lxCid(t.client_id) || raw.cId || "passage",
          clientNom: t.client_nom, clientPrenom: t.client_prenom,
          stId: t.collaborateur_id, stNom: t.collaborateur_nom,
          items: t.items || [],
          brutTotal: Number(t.total_brut), remise: Number(t.total_remise),
          pr: Number(t.total_ttc), totalHT: Number(t.total_ht),
          totalTVA: Number(t.total_tva), tauxTVA: Number(t.taux_tva),
          met: t.mode_paiement, paymentDetail: t.detail_paiement,
          st: t.status === "cancelled" ? "cancelled" : "done",
          cancelled: t.status === "cancelled",
          tkNum: t.num, hash: t.hash, hashPrev: t.hash_prev,
          locked: t.locked, clotureId: t.cloture_id,
          notes: t.notes
        });
      });
    } else {
      window.TICKETS_DB = [];
    }
  } catch(e) { console.warn("[loadSalonData] tickets load skipped", e); window.TICKETS_DB = []; }

  // 8.55 / 8.6 — déplacés en tête de loadSalonData (section 2.5) via
  // loadPendingAndDevis(). Re-tentative ici comme filet de sécurité au cas
  // où l'auth/session aurait été établie entre-temps.
  await loadPendingAndDevis();

  // 9. Charger clôtures → window.CLOTURES[]
  try {
  // Limit 500 clôtures (= ~1 an et demi à raison d'1/jour ouvré). Charge les plus
  // récentes (num DESC). Pour consulter une clôture plus ancienne, l'app utilise
  // loadOlderClotures() à la demande quand l'utilisateur sélectionne une période
  // ancienne dans la nav compta. Garantit chargement initial rapide à grande échelle.
  var clotRes = await _sb.from("clotures").select("*").eq("salon_id", _salonId).order("num", { ascending: false }).limit(500);
  // On ré-inverse l'ordre côté JS pour avoir num croissant en mémoire (compatibilité
  // avec le code existant qui attend cet ordre, ex: chaîne hash, cumuls, etc.).
  if (clotRes.data) clotRes.data.reverse();
  if (clotRes.data) {
    window.CLOTURES = clotRes.data.map(_mapClotureRow);
    // FIX 2026-05-12 : reconstitue LOCKED_DAYS depuis CLOTURES après chaque load DB.
    // Avant ce fix, si Amandine ouvrait l'app sur un autre appareil (ou cache vidé),
    // LOCKED_DAYS était vide → le check de blocage dans showCaisse()/mD() était bypass
    // → on pouvait encaisser après cloture Z. Maintenant la source de vérité c'est DB.
    if (!window.LOCKED_DAYS) window.LOCKED_DAYS = {};
    window.CLOTURES.forEach(function(c){ if (c && c.date) window.LOCKED_DAYS[c.date] = true; });
    try { localStorage.setItem("_cp_locked", JSON.stringify(window.LOCKED_DAYS)); } catch(_){}
  }
  try { await lxChargerAnnotationsZ(); } catch(_eAn) {} // 2026-10-16 : annotations correctives des Z
  } catch(e) { console.warn("[loadSalonData] clotures skipped", e); }

  // 10. Charger audit log → window.AUDIT_LOG[]
  try {
    var auRes = await _sb.from("audit_log").select("*").eq("salon_id", _salonId).order("timestamp_action", { ascending: false }).limit(500);
    if (auRes.data) {
      window.AUDIT_LOG = auRes.data.map(function(a) {
        return { ts: a.timestamp_action, action: a.action, detail: a.details };
      });
    }
  } catch(e) { console.warn("[loadSalonData] audit_log skipped", e); }

  // 11. Charger forfaits → FORFAITS[]
  try {
    var fRes = await _sb.from("forfaits").select("*").eq("salon_id", _salonId).order("id");
    if (fRes.data && !fRes.error) { window._lxTableOk = window._lxTableOk || {}; window._lxTableOk.forfaits = true; }
    // 2026-10-14 : on prend la liste de la base des qu'il n'y a pas d'erreur, MEME vide
    // (sinon le dernier forfait supprime revenait depuis le cache).
    if (fRes.data && !fRes.error) {
      FORFAITS = fRes.data.map(function(f) {
        return { id: f.id, n: f.nom, p: Number(f.prix), cat: f.categorie || "", services: f.services || [], phases: f.phases || [], showSite: f.show_site !== false, bookOnline: f.book_online !== false, catGenre: f.cat_genre || null,
          devis: f.prix_sur_devis === true, apartir: f.prix_a_partir_de === true && f.prix_sur_devis !== true }; // 2026-10-15
      });
      try { if (fRes.data.length) { window._lxColsCat.forfDevis = Object.prototype.hasOwnProperty.call(fRes.data[0], "prix_sur_devis"); window._lxColsCat.forfApd = Object.prototype.hasOwnProperty.call(fRes.data[0], "prix_a_partir_de"); } } catch(_eC) {}
      try { _lxCatSigReset("forfaits", FORFAITS); } catch(_eSig) {}
      try { localStorage.setItem("_cp_forfaits", JSON.stringify(FORFAITS)); } catch(_eLs) {}
    }
  } catch(e) { console.warn("[loadSalonData] forfaits skipped", e); }

  // 12. Charger packs clients → window.PACKS_CLIENTS[]
  try {
    var pkResPacks = await _sb.from("packs_clients").select("*").eq("salon_id", _salonId).order("created_at", { ascending: false });
    if (pkResPacks.data) {
      window.PACKS_CLIENTS = pkResPacks.data.map(function(p) {
        return { id: p.id, clientId: p.client_id, clientNom: p.client_nom, nom: p.nom, prestId: p.prestation_id, prestNom: p.prestation_nom, total: p.total_seances, used: p.seances_utilisees, prix: Number(p.prix_total), dateAchat: p.date_achat, dateExp: p.date_expiration, ticketNum: p.ticket_num, status: p.status };
      });
    } else {
      window.PACKS_CLIENTS = [];
    }
  } catch(e) { console.warn("[loadSalonData] packs_clients skipped", e); window.PACKS_CLIENTS = window.PACKS_CLIENTS || []; }

  // Filet de sécurité final — re-load PENDING_TK + DEVIS si vides
  // (peut arriver en cas de transient timeout au boot)
  try {
    if ((!window.PENDING_TK || !window.PENDING_TK.length) ||
        (!window.DEVIS || !window.DEVIS.length)) {
      await loadPendingAndDevis();
    }
  } catch(e) {}
  console.log("[Luxyra] Pending="+(window.PENDING_TK||[]).length+" Devis="+(window.DEVIS||[]).length);

  // FIX 2026-10-07 : CONFIG DU SITE + HORAIRES DU SALON chargés AVANT le lancement de l'app.
  // Avant, loadSiteConfig() n'était appelée qu'UNE fois, 1 s après l'ouverture de la page :
  // sur un login frais (_salonId pas encore posé) elle ne faisait rien, et ne retentait jamais.
  // SITE_CONFIG restait vide (réglages du site abandonnés) et H gardait les horaires codés en dur
  // — ceux d'Excellence Coiffure — que l'app republiait ensuite par-dessus les vrais horaires
  // du salon (constaté chez Delphinecoiff les 05/10 et 06/10). Attente bornée à 8 s.
  try {
    if (typeof loadSiteConfig === "function") {
      await Promise.race([
        Promise.resolve(loadSiteConfig()),
        new Promise(function(res){ setTimeout(function(){ res(false); }, 8000); })
      ]);
    }
  } catch(e) { console.warn("[loadSalonData] site_config non chargée", e); }

  window._lxChargementEnCours = false;
  // Lancer l'app !
  console.log("Luxyra: Données chargées depuis Supabase (" + CL.length + " clients, " + AP.length + " RDV, " + PRODS.length + " produits)");
  // Show header again after login
  var hdr = document.getElementById("hdr");
  if (hdr) hdr.style.display = "";
  initApp(); // ← appelle la fonction d'init existante de l'app
  // Update notification badge after data is loaded
  setTimeout(function() {
    if (typeof updateNotifBadge === "function") updateNotifBadge();
    // Also show pending count in console
    var pending = (window.RDV_ONLINE || []).filter(function(r) { return r.status === "pending"; });
    if (pending.length > 0) console.log("Luxyra: " + pending.length + " RDV en ligne en attente de confirmation !");
  }, 500);
  // NF525 : Charger les opérateurs et afficher l'écran de sélection si configurés
  if (typeof refreshOperateurs === "function") {
    setTimeout(function(){
      refreshOperateurs().then(function(){
        // Show banner if no operators OR no admin among them
        var noOps = !OPERATEURS || !OPERATEURS.length;
        var hasAnyAdmin = OPERATEURS && OPERATEURS.some(function(o){return o.role === "admin" && o.actif;});
        if (typeof showOperateursSetupBanner === "function" && (noOps || !hasAnyAdmin)) {
          showOperateursSetupBanner();
        } else if (typeof hideOperateursSetupBanner === "function") {
          hideOperateursSetupBanner();
        }
        // Refresh header to show avatar
        if (typeof updateOperatorAvatar === "function") updateOperatorAvatar();
      });
    }, 600);
  }
  // === CACHE INDEXEDDB : sauvegarde du snapshot après fetch full ===
  // À ce stade toutes les variables globales (T, SV, PR, CL, AP, CLOTURES, etc.)
  // sont remplies avec les data fraîches. On capture l'état et on l'écrit en
  // arrière-plan dans IndexedDB pour le prochain démarrage. Non-bloquant : si
  // l'écriture échoue, le user n'en sait rien et le flow continue.
  if (window.LX_CACHE_ENABLED && _salonId && !window._archiveMode) {
    try {
      var snap = _captureSnapshot();
      // setTimeout 0 = non-bloquant pour go("home") qui suit
      setTimeout(function(){
        writeCacheSnapshot(_salonId, snap).then(function(ok){
          if (ok) console.log("[cache] snapshot saved for salon "+_salonId);
        }).catch(function(){});
      }, 0);
    } catch(e){ console.warn("[cache] capture failed:", e); }
  }
  }catch(err){window._lxChargementEnCours = false; console.error("loadSalonData error:",err);}
}

function showSuspendedScreen(status, salon) {
  var el = document.getElementById("app") || document.body;
  // Traduction FR + style premium Luxyra (au lieu de "Compte cancelled" en anglais)
  var titre = status === "suspended" ? "Abonnement suspendu" : "Abonnement annulé";
  var msg   = status === "suspended"
    ? "Votre abonnement est suspendu suite à un défaut de paiement. Mettez à jour votre moyen de paiement pour réactiver l'accès immédiatement."
    : "Votre abonnement a été résilié. Vous pouvez reprendre un abonnement à tout moment, ou accéder à vos documents comptables en lecture seule.";
  // 2026-10-12 : établissement fermé définitivement
  var _ferme = !!(salon && salon.ferme_le);
  if (_ferme) {
    titre = "Établissement fermé";
    msg = "Cet établissement a été fermé définitivement le " + new Date(salon.ferme_le).toLocaleDateString("fr-FR") + ". Ses documents de caisse restent consultables en lecture seule pendant 6 ans. Vous pouvez ouvrir un nouvel établissement avec cette même adresse e-mail.";
  }
  var iconSvg = status === "suspended"
    ? '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
    : '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';

  // Mode Archives : visible uniquement pour les comptes "cancelled" (résiliés).
  // Calcul de la date de fin de conservation : cancelled_at + 6 ans (CGI art. L102 B).
  var archiveBlock = "";
  if (status === "cancelled") {
    var endDate = "";
    var monthsLeft = "";
    if (salon && salon.cancelled_at) {
      try {
        var cAt = new Date(salon.cancelled_at);
        var endD = new Date(cAt); endD.setFullYear(endD.getFullYear() + 6);
        endDate = endD.toLocaleDateString("fr-FR", { day:"2-digit", month:"long", year:"numeric" });
        var diffMs = endD - new Date();
        var monthsTot = Math.max(0, Math.round(diffMs / (1000*60*60*24*30.44)));
        monthsLeft = monthsTot >= 12 ? Math.floor(monthsTot/12) + " an" + (monthsTot >= 24 ? "s" : "") + (monthsTot%12 ? " et " + (monthsTot%12) + " mois" : "") : monthsTot + " mois";
      } catch(e) { endDate = ""; }
    }
    archiveBlock = ''
      + '<div style="margin-top:14px;padding:14px 16px;background:rgba(212,168,67,.05);border:1px solid rgba(212,168,67,.2);border-radius:12px;text-align:left">'
      +   '<div style="display:flex;align-items:start;gap:10px">'
      +     '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#d4a843" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>'
      +     '<div style="flex:1">'
      +       '<div style="color:#d4a843;font-size:12px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;margin-bottom:4px">Vos documents sont conservés</div>'
      +       '<div style="color:#94a3b8;font-size:12px;line-height:1.55">Conformément à la loi française (CGI art. L102 B), vos clôtures Z, factures et données comptables restent accessibles <strong style="color:#fff">6 ans</strong>'+(endDate?' — soit jusqu\'au <strong style="color:#fff">'+endDate+'</strong>'+(monthsLeft?' ('+monthsLeft+' restants)':''):'')+'.</div>'
      +     '</div>'
      +   '</div>'
      + '</div>'
      + '<button onclick="enterArchiveMode()" style="margin-top:14px;display:inline-flex;align-items:center;justify-content:center;gap:9px;padding:13px 24px;background:transparent;color:#d4a843;font-weight:700;border:1.5px solid rgba(212,168,67,.45);border-radius:11px;cursor:pointer;font-size:13px;letter-spacing:.4px;text-transform:uppercase;transition:all .2s;width:100%" onmouseover="this.style.background=\'rgba(212,168,67,.08)\';this.style.borderColor=\'#d4a843\'" onmouseout="this.style.background=\'transparent\';this.style.borderColor=\'rgba(212,168,67,.45)\'">'
      +   '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>'
      +   'Accéder à mes archives comptables'
      + '</button>';
  }

  el.innerHTML = ''
    + '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(180deg,#0a0a0a 0%,#0c0c12 100%);padding:20px">'
    +   '<div style="text-align:center;max-width:460px;padding:32px;background:rgba(20,20,25,.8);border:1px solid rgba(255,255,255,.08);border-radius:20px;backdrop-filter:blur(12px)">'
    +     '<div style="display:inline-block;padding:18px;background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.25);border-radius:18px;margin-bottom:18px">'+iconSvg+'</div>'
    +     '<h2 style="color:#fff;font-family:Georgia,\'Times New Roman\',serif;font-weight:600;font-size:24px;margin:0 0 8px;letter-spacing:.3px">'+titre+'</h2>'
    +     '<p style="color:#94a3b8;font-size:14px;line-height:1.6;margin:0 0 24px">'+msg+'</p>'
    +     '<button onclick="'+(_ferme?'location.href=\'/inscription.html\'':'openCustomerPortal()')+'" style="display:inline-flex;align-items:center;justify-content:center;gap:10px;padding:14px 28px;background:linear-gradient(135deg,#d4a843,#b8960f);color:#0a0a0a;font-weight:800;border:none;border-radius:12px;cursor:pointer;font-size:14px;letter-spacing:.5px;text-transform:uppercase;box-shadow:0 4px 16px rgba(212,168,67,.35);transition:all .2s;width:100%" onmouseover="this.style.transform=\'translateY(-1px)\';this.style.boxShadow=\'0 6px 20px rgba(212,168,67,.45)\'" onmouseout="this.style.transform=\'translateY(0)\';this.style.boxShadow=\'0 4px 16px rgba(212,168,67,.35)\'">'
    +       '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M7 15h0M2 9h20"/></svg>'
    +       (_ferme ? 'Ouvrir un nouvel établissement' : (status === "suspended" ? 'Régulariser mon paiement' : 'Reprendre un abonnement'))
    +     '</button>'
    +     archiveBlock
    +     '<div style="margin-top:18px"><button onclick="doLogout()" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:13px;text-decoration:underline">Se déconnecter</button></div>'
    +     '<div style="margin-top:24px;padding-top:18px;border-top:1px solid rgba(255,255,255,.05);font-size:11px;color:#64748b;line-height:1.5">Si vous pensez qu\'il s\'agit d\'une erreur, contactez-nous : <a href="mailto:contact@luxyra.fr" style="color:#d4a843;text-decoration:none">contact@luxyra.fr</a></div>'
    +   '</div>'
    + '</div>';
  var hdr=document.getElementById("hdr"); if(hdr)hdr.style.display="none";
}

// Bouton "Accéder à mes archives" → set le flag sessionStorage et reload.
// Le flag est lu au prochain loadSalonData(), qui skip le showSuspendedScreen
// et continue le chargement normal avec _archiveMode=true.
// 2026-10-12 : archives d'un ancien établissement fermé du même compte
function lxOuvrirArchivesAncien(id){
  try { sessionStorage.setItem("luxyra_archive_salon", id); sessionStorage.setItem("luxyra_archive_mode", "1"); } catch(e){}
  window.location.reload();
}
window.lxOuvrirArchivesAncien = lxOuvrirArchivesAncien;
function enterArchiveMode(){
  try {
    sessionStorage.setItem("luxyra_archive_mode", "1");
    sessionStorage.setItem("luxyra_archive_entered_at", new Date().toISOString());
  } catch(e){}
  window.location.reload();
}

// Quitter le mode archives (retour à l'écran "Abonnement annulé")
function exitArchiveMode(){
  try { sessionStorage.removeItem("luxyra_archive_mode"); sessionStorage.removeItem("luxyra_archive_salon"); } catch(e){}
  window.location.reload();
}
window.enterArchiveMode = enterArchiveMode;
window.exitArchiveMode = exitArchiveMode;

function showTrialExpiredScreen(salon) {
  var el = document.getElementById("app") || document.body;
  document.getElementById("hdr").style.display="none";
  el.innerHTML = '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg,#0a0e1a)">'+
    '<div style="text-align:center;max-width:440px;padding:32px">'+
    '<div style="font-size:56px;margin-bottom:16px">⏰</div>'+
    '<h2 style="color:var(--gold,#d4a843);margin-bottom:8px;font-size:24px">Votre essai est terminé</h2>'+
    '<p style="color:#94a3b8;margin-bottom:24px;font-size:15px;line-height:1.6">Merci d\u2019avoir testé Luxyra !<br>Pour continuer à utiliser Luxyra, choisissez votre formule.</p>'+
    '<div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap;justify-content:center">'+
    '<div style="flex:1;min-width:180px;background:rgba(96,165,250,.08);border:1px solid rgba(96,165,250,.2);border-radius:14px;padding:20px;text-align:center">'+
    '<div style="font-size:12px;color:#60a5fa;font-weight:700;letter-spacing:1px;margin-bottom:8px">ESSENTIEL</div>'+
    '<div style="font-size:28px;font-weight:800;color:#fff"><span data-lxconfig="plan_essential">14,99</span>\u20ac<span style="font-size:14px;color:#94a3b8">/mois</span></div>'+
    '<div style="font-size:11px;color:#94a3b8;margin-top:8px">Planning \u2022 Encaissement \u2022 Clients</div>'+
    '<button onclick="checkCgvAndPay(\'essential\')" style="margin-top:12px;width:100%;padding:10px;border-radius:10px;background:#60a5fa;color:#fff;font-weight:700;border:none;cursor:pointer;font-size:13px">Choisir Essentiel</button>'+
    '</div>'+
    '<div style="flex:1;min-width:180px;background:rgba(212,168,67,.08);border:1.5px solid rgba(212,168,67,.3);border-radius:14px;padding:20px;text-align:center;position:relative">'+
    '<div style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:#d4a843;color:#000;font-size:9px;font-weight:800;padding:3px 10px;border-radius:50px;letter-spacing:1px">RECOMMANDÉ</div>'+
    '<div style="font-size:12px;color:#d4a843;font-weight:700;letter-spacing:1px;margin-bottom:8px">PRO</div>'+
    '<div style="font-size:28px;font-weight:800;color:#fff"><span data-lxconfig="plan_pro">24,99</span>\u20ac<span style="font-size:14px;color:#94a3b8">/mois</span></div>'+
    '<div style="font-size:11px;color:#94a3b8;margin-top:8px">Tout Essentiel + Site \u2022 Résa \u2022 SMS</div>'+
    '<button onclick="checkCgvAndPay(\'pro\')" style="margin-top:12px;width:100%;padding:10px;border-radius:10px;background:linear-gradient(135deg,#d4a843,#b8960f);color:#000;font-weight:700;border:none;cursor:pointer;font-size:13px">Choisir Pro</button>'+
    '</div>'+
    '</div>'+
    '<label style="display:flex;align-items:flex-start;gap:8px;margin:16px 0 12px;cursor:pointer;font-size:11px;color:#94a3b8;line-height:1.4;text-align:left"><input type="checkbox" id="cgvCheck" style="margin-top:2px;flex-shrink:0"> J\u2019accepte les <a href="/cgv" target="_blank" style="color:#d4a843">CGV</a> et la <a href="/confidentialite" target="_blank" style="color:#d4a843">Politique de confidentialit\u00e9</a></label>'+
    '<button onclick="doLogout()" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:13px">Se déconnecter</button>'+
    '</div></div>';
  // Refresh les éléments [data-lxconfig] avec les valeurs actuelles de la config DB
  if (typeof lxRefreshPriceElements === "function") {
    setTimeout(function(){ lxRefreshPriceElements(); }, 100);
  }
}

// Mode hors ligne (pas de Supabase configuré)
function startOffline() {
  _isOnline = false;
  // Bloquer l'accès sans Supabase
  var el = document.getElementById("app") || document.body;
  el.innerHTML = '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg,#0a0e1a);font-family:var(--f1,sans-serif)"><div style="text-align:center;max-width:400px;padding:32px"><div style="font-size:48px;margin-bottom:16px">🔒</div><img src="data:image/webp;base64,UklGRigDAABXRUJQVlA4IBwDAACQDwCdASowADAAPlEij0WjoaETnASQOAUEsYBXJ605F9ePOejDbec73pwG84/6hxHu6q1dzC/+R9wHs1+hv+V/efgG/Vr/Z9eT9t/Yt/XlTKjrpPnVbcfCR8tAOR6dRsfqF3udzZAdGylkMu2pczclBrwDhuRUDlbkjXhfxbiQjs9IdEwgAP78pX/Fh/xQon4sa1CAyc1/ohBG4jmXYWWfjbcyo11jsoAEsbKeULzwh4FPpVJacD7br1LCiiTDp6xN56OfIpUJgCP+FWVUJOptF9MFJb8tE/3ifo4Ng0+lY/VlDL4D/TB2T4CbrArX9vFDoA8SUi/m517TEcmWSSbht5H+dTrB2o0es+G2o659GdTCDQNyr9Hh8vrb3Y6Cc6zsBIJZMqmmOLAm9+SJtf95P9+xYORz7ZuF8tvS94dtKJwJGMeX8OQXzRL0KFHATmXJUqnLKsq/v1Zf1kmomC9u7aTBJ/4O7vOnFN6wS2rvppGtBvfLZ/FtS03eYzgPGzOItPGsadUwy7fTb/FZEnSeVSH1zzIXIEq/8+S7Ccq2dHZ69n6L9OXHDU5ajWGModmSmmOJLh/aBVTZvjrBUfHG4B0cxIHE16Jy/o5+f+wQRxjDHFxSihTQKV4cl4Vb322dDJx61utw0XwrKdyfqVuW7nGFAECCSOFIpzrlhBKChYG2Vd9wgu58MRtO2nPzXO1PkMGAe+QaaBL1S71cD0zDIE3yhpFNwL+TMswCh6JWdmOur6ca76M1MH1a76WXsgpuEc7lPJi3+mziL0Dv52LSajdG/5teMdG2pP/5GsX1GyLUZK9NnA2iIGNVArxMbvXQ15D/UVozmLf0GPQ5ICgwSw5Iv76FLCxKVsgS8ARQG8E3hqqMSb7XYCoHuYkTlowqF0qTthXyq89GJ++pf7hud/OAcFnN3z5dNSSvK8XkfJdwyJKp9Pcsug48wzT+NiKadVrEIS2eKfhxhdS8bzoWPR96Ff4lh9zxrh2Q8iLrcjwyaE+NrgC+wprpy9eV3uy1L7nH2heVxDPHLS4Qou4afIINoUvdBbv7wAAA" style="width:48px;height:48px;border-radius:10px;margin-bottom:8px" alt="L"><div style="font-size:28px;font-weight:900;color:var(--gold,#d4a843);font-family:Georgia,serif;letter-spacing:3px;margin-bottom:8px">Luxyra</div><p style="color:#94a3b8;margin-bottom:8px">Connexion au serveur impossible.</p><p style="color:#64748b;font-size:13px">Vérifiez votre connexion internet ou contactez contact@luxyra.fr.</p></div></div>';
}


// ============================================================
// SAVE DATA — Sauvegarder vers Supabase après chaque action
// ============================================================

// Liste des clés qui partent dans la colonne fiche_tech (JSONB).
// Tout ce qui n'est PAS déjà mappé sur une colonne dédiée (nom, email,
// nature_cheveux, etc.) et qui appartient à la fiche technique étendue
// passe par ici. Ça évite de multiplier les colonnes spécifiques métier.
var _FICHE_TECH_KEYS = [
  // Cheveux étendus (en plus de nat/type/det déjà persistés)
  "longueurChev","cuirChev","allergiesChev","formules",
  // Peau (esthétique)
  "typePeau","phototype","pbPeau","pilosite","zonesEpil",
  "allergiesPeau","dernierSoinPeau","detPeau",
  // Ongles
  "etatOngles","formeOngles","tailleCapsules","techniqueOngles",
  "couleursOngles","allergiesOngles","detOngles",
  // Bien-être
  "objectifBE","pressionBE","dureeBE","frequenceBE",
  "zonesSensibles","contrIndBE","detBE",
  // Photos avant/après
  "photos",
  // 2026-10-11 : historique des relances « clients inactifs » (anti-harcèlement)
  "relances",
  // Historique structuré par métier (barbier/esthétique/ongles/bien-être).
  // Coiffure utilise toujours `formules` ci-dessus pour les formules couleur.
  "histoMetier",
  // 2026-10-11 : soldes fidélité des modes « cagnotte » et « CA cumulé » (perdus au rechargement avant)
  "cagnotte","caTotal"
];

// FIX 2026-05-12 : helper de migration legacy local-id → UUID.
// U() génère maintenant des UUIDs valides via crypto.randomUUID(), mais des
// entités créées dans une session précédente (avant ce fix) peuvent encore
// avoir un id "u17_lxa6" en localStorage. Au prochain saveX, on les normalise
// en UUID avant l'upsert (le DB column id est de type UUID, refuse autre chose).
function _ensureUuidId(entity) {
  if (!entity) return null;
  var id = entity.id;
  var isUuid = (typeof id === "string" && id.length === 36 && id.indexOf("-") > 0);
  if (!isUuid) {
    try {
      if (typeof crypto !== "undefined" && crypto.randomUUID) entity.id = crypto.randomUUID();
      else entity.id = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c){
        var r = Math.random()*16|0, v = c==="x"?r:(r&0x3|0x8); return v.toString(16);
      });
    } catch(e) {
      entity.id = "00000000-0000-4000-8000-" + Date.now().toString(16).padStart(12, "0");
    }
  }
  return entity.id;
}
if (typeof window !== "undefined") window._ensureUuidId = _ensureUuidId;

// Sauvegarder un client (create ou update)
// ============================================================
// REMONTEE UNIFORME DES ECHECS DE SAUVEGARDE (FIX 2026-08-04)
// Constat : seuls saveAppointment et saveTicketToDb journalisaient un DB_ERROR
// (seule action, avec NF525_SEAL_TRIGGER_FAIL, ecoutee par le trigger d'alerte
// => mail support@luxyra.fr + notification telephone). Les autres sauvegardes se
// contentaient d'un console.warn/console.error : au mieux visibles dans le panneau
// Monitoring, au pire TOTALEMENT MUETTES (console.warn n'est pas intercepte).
// Une sauvegarde qui echoue = des donnees perdues sans que personne ne le sache :
// c'est exactement ce qui a laisse durer 3 mois le bug des fiches techniques.
// Best-effort : n'echoue jamais, ne bloque jamais l'appelant.
// ============================================================
function _lxReportDbError(fnName, err, extra) {
  try {
    if (!err) return;
    var payload = { fn: fnName,
      msg: (err && (err.message || err.details)) || String(err),
      code: (err && err.code) || null,
      hint: (err && err.hint) || null };
    if (extra && typeof extra === "object") {
      for (var k in extra) { if (Object.prototype.hasOwnProperty.call(extra, k)) payload[k] = extra[k]; }
    }
    if (typeof saveAuditEntry === "function") {
      saveAuditEntry("DB_ERROR", JSON.stringify(payload).slice(0, 2000));
    }
  } catch (_) {}
}
if (typeof window !== "undefined") window._lxReportDbError = _lxReportDbError;


// 2026-10-07 : colonnes ecrites pour une fiche client (sans salon_id ni id), depuis l'objet memoire.
function _lxClientData(client) {
  var ft = {};
  _FICHE_TECH_KEYS.forEach(function(k){
    if (client[k] !== undefined && client[k] !== null) ft[k] = client[k];
  });
  var data = {
        nom: client.nom, prenom: client.pre, sexe: client.sex,
    telephone: client.ph, telephone2: client.ph2, email: client.em,
    adresse: client.adr, cp: client.cp, ville: client.ville,
    date_naissance: client.ddn, notes: client.no,
    nature_cheveux: client.natChev, type_cheveux: client.typeChev,
    details_cheveux: client.detChev, collab_pref: client.collab,
    actif: client.actif, points_fidelite: client.fid,
    sms_ok: client.smsOk, email_ok: client.emOk, fiches: client.fiches || [],
    acompte_online: client.acompteOnline || 'defaut',
    // Acquisition source (Quick Win 2026-05-06) — optionnel, NULL si pas renseigné
    acquisition_source: client.acqSrc || null,
    acquisition_parrain: client.acqParrain || null,
    // Liens famille (mai 2026) : array d'IDs UUID des clients liés
    famille_ids: client.famille_ids || []
  };
  // CEINTURE + BRETELLES (FIX 2026-08-04) : n'ecrire `fiche_tech` QUE s'il porte
  // reellement du contenu. `ft` est reconstruit depuis la MEMOIRE ; si un jour un
  // chemin de chargement oubliait de deballer fiche_tech, `ft` vaudrait {} et cette
  // colonne serait ECRASEE (formules couleur, photos avant/apres...). Cle absente du
  // payload => l'upsert PostgREST ne touche pas la colonne (meme garde que ticket_html).
  if (Object.keys(ft).length > 0) data.fiche_tech = ft;
  return data;
}
// 2026-10-07 : sauvegardes d'une meme fiche mises en file (deux sauvegardes rapprochees ne doivent
// pas appliquer deux fois la meme difference de points / de stock).
var _lxFileFiches = {};
function _lxEnFile(cle, fn){
  var prec = _lxFileFiches[cle] || Promise.resolve();
  var p = prec.then(fn, fn);
  _lxFileFiches[cle] = p.then(function(){}, function(){});
  return p;
}
function saveClient(client) { return _lxEnFile("c:" + ((client && client.id) || "nouveau"), function(){ return _saveClientUneFois(client); }); }
async function _saveClientUneFois(client) {
  // FIX 2026-08-04 : renvoie desormais un STATUT REEL {ok:...}. Sans lui, aucun appelant ne
  // pouvait savoir si la sauvegarde avait abouti -> les ecrans affichaient "enregistre" en
  // aveugle. Les appelants existants qui ignorent la valeur de retour ne changent pas.
  var _rejeu = !!window._walBypass; // 2026-10-14 audit : lu de façon synchrone (rejeu de la file de secours)
  var _t0 = new Date().toISOString(); // 2026-10-14 audit
  if (_lxEcrituresBloquees()) return { ok: false, skipped: true, reason: "lecture seule" }; // 2026-10-14 audit : archives / suspendu
  if (!_isOnline || !_salonId) {
    // 2026-10-14 audit : hors ligne -> mise en file (avant : rien n'était conservé) + message
    if (_salonId && !_rejeu && client) { _walPersist("client", client, { base: client._lxBase }); _lxSignalerNonEnregistre(client); }
    return { ok: false, skipped: true };
  }
  // WAL : persiste l'action en LS AVANT tout traitement (filet 15/05/2026)
  // 2026-10-14 audit : avec la base de fusion (_lxBase) -> le rejeu n'écrase pas les changements d'un autre appareil
  var _walId = _rejeu ? null : _walPersist("client", client, { base: client && client._lxBase });
  var _r = await _saveClientCorps(client, _walId);
  if (_walResultatOk(_r)) { _lxMarquerEnregistre(client); if (!_rejeu && client) _walRendreCaduques("client", client.id, _t0); }
  else if (!(_r && _r.permanent)) {
    try { _lxControleSession(_r && _r.error, !!(_r && _r.vide)); } catch(_eS) {}
    if (!_rejeu) _lxSignalerNonEnregistre(client);
  }
  return _r;
}
async function _saveClientCorps(client, _walId) {
  // Toast auto-save discret (debounced)
  // Construit le bucket fiche_tech à partir des champs étendus présents
  // sur l'objet client en mémoire. On ne pousse que les valeurs définies
  // pour ne pas écraser une fiche existante avec des undefined.
  var ft = {};
  _FICHE_TECH_KEYS.forEach(function(k){
    if (client[k] !== undefined && client[k] !== null) ft[k] = client[k];
  });
  var data = _lxClientData(client);
  data.salon_id = _salonId;

  // FIX 2026-05-12 : upsert avec id explicite (U() génère un UUID stable
  // dès la création) → INSERT ou UPDATE selon existence du PK. Plus de
  // mutation d'id, plus de race condition.
  _ensureUuidId(client);
  data.id = client.id;
  // 2026-10-07 : fiche deja en base -> fusion avec la version en base (synchro entre appareils)
  var _fusionRow = null;
  if (client._lxBase) {
    try {
      var _cur = await _sb.from("clients").select("*").eq("id", client.id).eq("salon_id", _salonId).maybeSingle();
      // 2026-10-14 audit : fiche déjà en base (base de fusion présente) mais introuvable ou fusionnée dans une autre
      // -> supprimée / fusionnée sur un autre appareil : la sauvegarde la RESSUSCITERAIT. On annule, on retire la
      // fiche de la mémoire et on prévient. (Session vérifiée d'abord : sans session, la lecture est vide aussi.)
      if (!_cur.error && (!_cur.data || _cur.data.fusionne_dans)) {
        var _sess = null; try { _sess = (await _sb.auth.getSession()).data.session; } catch(_eSs) {}
        if (!_sess) { return { ok: false, error: { message: "session absente" }, vide: true }; }
        try { if (typeof CL !== "undefined" && Array.isArray(CL)) { for (var _ci = CL.length - 1; _ci >= 0; _ci--) { if (CL[_ci] && CL[_ci].id === client.id) CL.splice(_ci, 1); } } } catch(_eCl) {}
        _walMarkSynced(_walId);
        console.warn("[saveClient] fiche supprimée ou fusionnée ailleurs, sauvegarde annulée :", client.id);
        try { if (typeof toast === "function") toast("La fiche de " + (((client.pre || "") + " " + (client.nom || "")).trim() || "ce client") + " a été supprimée ou fusionnée sur un autre appareil : modification non enregistrée.", "warning"); } catch(_eT) {}
        return { ok: false, permanent: true, supprime: true };
      }
      if (!_cur.error && _cur.data) {
        _fusionRow = _cur.data;
        var _dbData = _lxClientData(lxMapClientRow(_cur.data));
        var _mem = Object.assign({}, data); delete _mem.id; delete _mem.salon_id;
        var _confC = [];
        var _fus = _lxFusionFiche(client._lxBase, _mem, _dbData, { compteurs:["points_fidelite"], listes:["fiches","famille_ids"], objets:["fiche_tech"], conflits:_confC });
        _lxSignalerConflits("Fiche client", ((client.pre||"")+" "+(client.nom||"")).trim(), _confC);
        if (_fus.points_fidelite !== undefined && _fus.points_fidelite < 0) _fus.points_fidelite = 0;
        data = Object.assign({ id: client.id, salon_id: _salonId }, _fus);
      }
    } catch(_eF) { _fusionRow = null; }
  }
  var res = await _sb.from("clients").upsert(data).select();
  // 2026-10-14 audit : écriture « vide » (0 ligne renvoyée, sans erreur) = refus silencieux (droits / session)
  if (!res.error && (!res.data || !res.data.length)) {
    console.error("saveClient : 0 ligne enregistrée", client.id);
    _lxReportDbError("saveClient", { message: "0 ligne enregistrée (droits ou session)" }, { client_id: client.id || null });
    return { ok: false, error: { message: "0 ligne enregistrée" }, vide: true };
  }
  if (!res.error) {
    // memoire de l'appareil = ce qui est maintenant en base ; nouvelle reference
    try {
      var _apres = lxMapClientRow(Object.assign({}, _fusionRow || {}, (res.data && res.data[0]) || data));
      Object.keys(_apres).forEach(function(k){ client[k] = _apres[k]; });
      _lxPoserBase(client, _apres._lxBase);
    } catch(_eM) {}
  }
  if (res.error) {
    console.error("saveClient upsert error:", res.error);
    _lxReportDbError("saveClient", res.error, {client_id: client.id || null});
    return { ok: false, error: res.error };
  }
  // Cross-salon sync: update all client records + compte with same email
  if (client.em) {
    var syncClients = {}, syncBp = {};
    if (client.nom) { syncClients.nom = client.nom; syncBp.nom = client.nom; }
    if (client.pre) { syncClients.prenom = client.pre; syncBp.prenom = client.pre; }
    if (client.ph) { syncClients.telephone = client.ph; syncBp.telephone = client.ph; }
    if (client.sex) { syncClients.sexe = client.sex; syncBp.genre = client.sex; }
    if (client.adr) { syncClients.adresse = client.adr; syncBp.adresse = client.adr; }
    if (client.cp) { syncClients.cp = client.cp; syncBp.cp = client.cp; }
    if (client.ville) { syncClients.ville = client.ville; syncBp.ville = client.ville; }
    if (client.ddn) { syncClients.date_naissance = client.ddn; syncBp.date_naissance = client.ddn; }
    if (client.smsOk !== undefined) { syncClients.sms_ok = client.smsOk; syncBp.sms_ok = client.smsOk; }
    if (client.emOk !== undefined) { syncClients.email_ok = client.emOk; syncBp.email_ok = client.emOk; }
    try {
      // 2026-10-14 audit : SUPPRIMÉ — la copie de l'identité et du consentement (SMS / e-mail) vers TOUTES les fiches
      // portant le même e-mail (y compris celles d'autres personnes partageant une adresse, ou d'autres
      // établissements) écrasait leurs données. Seule la synchronisation contrôlée avec le compte Luxyra (RPC) reste.
      if (Object.keys(syncBp).length) {
        // FIX 2026-05-19 : passe par la RPC SECURITY DEFINER au lieu de UPDATE direct
        // (la policy UPDATE clients_luxyra ne sera plus qual=true mais filtrée par
        // auth.email(). La RPC bypass RLS de façon contrôlée + vérifie que le caller
        // est bien un salon, et n'autorise QUE les champs non-sensibles.)
        await _sb.rpc('sync_clients_luxyra_from_salon', {
          p_email: client.em,
          p_nom: syncBp.nom || null,
          p_prenom: syncBp.prenom || null,
          p_telephone: syncBp.telephone || null,
          p_genre: syncBp.genre || null,
          p_adresse: syncBp.adresse || null,
          p_cp: syncBp.cp || null,
          p_ville: syncBp.ville || null,
          p_date_naissance: syncBp.date_naissance || null,
          p_sms_ok: (syncBp.sms_ok === undefined ? null : syncBp.sms_ok),
          p_email_ok: (syncBp.email_ok === undefined ? null : syncBp.email_ok)
        });
      }
    } catch(e) { console.log("[SYNC]", e.message); }
  }
  // Sync fidelite_client.points when fid changes
  if (client.em && client.fid !== undefined && _salonId) {
    try {
      var fr = await _sb.from("fidelite_client").select("id").eq("client_luxyra_id", client.em).eq("salon_id", _salonId).limit(1);
      if (fr.data && fr.data[0]) {
        await lxEcritureVerifiee(_sb.from("fidelite_client").update({ points: client.fid }).eq("id", fr.data[0].id).select("id"), "points de fidélité du compte client", { toast:true }); // 2026-10-15
      }
    } catch(e) { console.log("[FIDELITE SYNC]", e.message); }
  }
  // WAL : marquer la sauvegarde comme synchronisée si on est arrivé ici sans throw
  _walMarkSynced(_walId);
  return { ok: true };
}

// Sauvegarder un rendez-vous/ticket
// 2026-10-10 : ticket ENCAISSÉ avec acompte payé EN LIGNE -> l'acompte est conservé dans items[].isAcompteData
// (retiré de la liste en mémoire par lxMapApptRow pour ne pas fausser stats/listes ; ré-ajouté ici à chaque écriture).
function _lxItemsAvecAcompteEnLigne(appt) {
  var its = Array.isArray(appt.items) ? appt.items : [];
  try {
    var ac = Number(appt.acompte) || 0;
    if ((appt.st === "done" || appt.tkNum) && ac > 0 && /ligne|stripe|online/i.test(String(appt.acompteMode || "")) && !its.some(function (x) { return x && x.isAcompteData; })) {
      return its.concat([{ isAcompteData: true, acompte: ac, acompteMode: appt.acompteMode, acompteDate: appt.acompteDate || null }]);
    }
  } catch (_e) {}
  return its;
}
// 2026-10-11 : chargement des RDV en ligne = TOUS les RDV actifs (en attente / confirmés, quelle que soit
// leur date de création) + l'historique des 13 derniers mois (exports mensuels), par pages de 1000
// (limite par requête de l'API). Avant : les 500 derniers créés seulement.
async function lxChargerRdvOnline() {
  var depuis = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
  var vus = {}, out = [], err = null;
  async function pages(q) {
    for (var p = 0; p < 20; p++) {
      var r = await q().range(p * 1000, p * 1000 + 999);
      if (r.error) { err = r.error; return; }
      (r.data || []).forEach(function (x) { if (!vus[x.id]) { vus[x.id] = 1; out.push(x); } });
      if (!r.data || r.data.length < 1000) return;
    }
  }
  await pages(function () { return _sb.from("rdv_online").select("*").eq("salon_id", _salonId).in("status", ["pending", "confirmed", "pending_payment"]).order("created_at", { ascending: false }); });
  await pages(function () { return _sb.from("rdv_online").select("*").eq("salon_id", _salonId).gte("date_rdv", depuis).order("created_at", { ascending: false }); });
  out.sort(function (a, b) { return String(b.created_at || "").localeCompare(String(a.created_at || "")); });
  return err && !out.length ? { data: null, error: err } : { data: out, error: null };
}
if (typeof window !== "undefined") window.lxChargerRdvOnline = lxChargerRdvOnline;
// 2026-10-14 (NF525) : saveAppointment renvoie désormais un résultat exploitable par la file de secours
// (_walResync) : objet sans .error en cas de succès, { ok:false, error, permanent } en cas d'échec,
// undefined hors ligne. Les appelants existants ignorent la valeur de retour (aucun changement pour eux).
// 2026-10-14 audit : enveloppe de saveAppointment — résultat TOUJOURS explicite ({ok:false,...} en cas d'échec),
// message « Non enregistré — nouvelle tentative automatique » + marque sur le RDV, contrôle de session après un
// échec, mise en file même hors ligne, mode archives respecté, RDV supprimé jamais recréé.
async function saveAppointment(appt) {
  var _rejeu = !!window._walBypass; // lu de façon synchrone (rejeu de la file de secours / appel interne)
  var _t0 = new Date().toISOString();
  if (!appt) return { ok: false, reason: "rendez-vous absent" };
  if (_lxEcrituresBloquees()) return { ok: false, skipped: true, reason: "lecture seule" };
  // 2026-10-28 (-3, v6.8.1) : copie d'un ticket CRÉÉ PAR LE SERVEUR (paiement en ligne) : déjà en base, propriété du serveur,
  // jamais réécrite par un appareil (son n° de la série serveur ne doit pas aller dans appointments.ticket_num).
  if (appt.serveur === true) return { ok: true, skipped: true, serveur: true };
  // 2026-10-14 audit caisse : ticket d'acompte local écarté comme DOUBLON (_lxAcompteDoublonEcarter) -> toute réécriture ultérieure
  // (file de secours rejouée, autre chemin) le garde neutralisé (jamais recompté dans la caisse). Placé AVANT la mise en file
  // pour que l'entrée de la file de secours soit elle aussi neutralisée.
  try { if (appt && appt.id && appt.acompteKey) { var _dbl = JSON.parse(localStorage.getItem("lx_ac_doublons") || "{}"); if (_dbl[appt.id]) { appt.cancelled = true; delete appt.cancelDate; appt.cancelReason = appt.cancelReason || _dbl[appt.id]; } } } catch (_eDbl) {}
  if (appt.id && !(appt.st === "done" || appt.tkNum) && _lxRdvSupprime(appt.id)) {
    console.warn("[saveAppointment] rendez-vous supprimé : sauvegarde ignorée", appt.id);
    return { ok: false, permanent: true, supprime: true };
  }
  if (!_isOnline || !_salonId) {
    if (_salonId && !_rejeu) { _walPersist("appointment", appt); _lxSignalerNonEnregistre(appt); }
    return { ok: false, skipped: true };
  }
  var _p, r;
  try { _p = _saveAppointmentUneFois(appt); } catch (eS) { _p = Promise.resolve({ ok: false, error: { message: String((eS && eS.message) || eS) } }); }
  try { r = await _p; } catch (eA) { r = { ok: false, error: { message: String((eA && eA.message) || eA) } }; }
  if (r === undefined || r === null) r = { ok: false, error: { message: "échec non confirmé" } };
  if (_walResultatOk(r)) { _lxMarquerEnregistre(appt); _lxApVu(appt.id); if (!_rejeu) _walRendreCaduques("appointment", appt.id, _t0); }
  else if (!_walResultatDoublonPermanent(r)) {
    try { _lxControleSession(r && r.error, !!(r && r.error && r.error.code === "LX_VIDE")); } catch (_eC) {}
    if (!_rejeu) _lxSignalerNonEnregistre(appt);
  }
  return r;
}
async function _saveAppointmentUneFois(appt) {
  if (!_isOnline || !_salonId) return { ok: false, skipped: true };
  // WAL : persiste l'action AVANT tout traitement (filet 15/05/2026)
  var _walId = window._walBypass ? null : _walPersist("appointment", appt);

  // === RDV ONLINE : route vers rdv_online (id préfixé "online_") ===
  // FIX 2026-05 : avant ce fix, saveAppointment update appointments avec l'id
  // "online_xxx" qui n'existe pas → 0 row updated → modif perdue au refresh.
  if (appt.id && typeof appt.id === "string" && appt.id.indexOf("online_") === 0) {
    var onlineUuid = appt.id.slice("online_".length);
    // FIX 2026-05-27 : RDV en ligne ENCAISSE -> persister un vrai rendez-vous "done" dans
    // appointments (id = uuid de la rdv_online, idempotent via upsert) pour qu'il reste sur
    // le planning avec le statut/logo "encaisse", exactement comme un RDV cree en salon.
    // Sinon : pas de ligne appointments -> le RDV disparaissait du planning au rechargement.
    if (appt.st === "done" || appt.tkNum) {
      try {
        var _apClone = {};
        for (var _k in appt) { if (Object.prototype.hasOwnProperty.call(appt, _k)) _apClone[_k] = appt[_k]; }
        _apClone.id = onlineUuid; // route vers la branche appointments classique (upsert)
        // 2026-10-10 : l'acompte payé EN LIGNE déduit à l'encaissement est conservé avec le RDV encaissé
        // (même support que l'acompte versé au salon : items[].isAcompteData) -> après un rechargement
        // ou sur un autre appareil, la clôture Z le range toujours en « Payé en ligne ».
        try {
          var _acOn = Number(appt.acompte) || 0;
          if (_acOn > 0 && /ligne|stripe|online/i.test(String(appt.acompteMode || ""))) {
            var _its = Array.isArray(appt.items) ? appt.items.slice() : [];
            if (!_its.some(function (x) { return x && x.isAcompteData; })) {
              _its.push({ isAcompteData: true, acompte: _acOn, acompteMode: appt.acompteMode, acompteDate: appt.acompteDate || null });
              _apClone.items = _its;
            }
          }
        } catch (_eAc) {}
        var _prevBypass = window._walBypass; window._walBypass = true;
        var _rDone, _pDone;
        try { _pDone = saveAppointment(_apClone); } finally { window._walBypass = _prevBypass; } // 2026-10-14 audit : drapeau lu de façon synchrone, non maintenu pendant l'attente
        _rDone = await _pDone;
        // 2026-10-14 (NF525) : échec de l'écriture du RDV encaissé -> on le signale à la file de secours (pas de « synchronisé » à tort)
        if (_rDone && typeof _rDone === "object" && (_rDone.error || _rDone.ok === false) && !_walResultatDoublonPermanent(_rDone)) { return _rDone; } // 2026-10-14 : RDV déjà en base -> on continue (rdv_online marqué encaissé)
      } catch (eDone) { console.warn("[saveAppointment online->done] persist appointment skipped:", eDone && eDone.message); return { ok: false, error: { message: String((eDone && eDone.message) || eDone) } }; }
      // Marque la rdv_online encaissee (compte client : RDV passe + facture ; dedup planning)
      // 2026-10-15 : resultat verifie (avant : echec muet -> RDV en ligne jamais marque encaisse cote client)
      try { lxEcritureVerifiee(_sb.from("rdv_online").update({ status: "done", ticket_num: (appt.tkNum || null) }).eq("id", onlineUuid).eq("salon_id", _salonId).select("id"), "statut « encaissé » du rendez-vous en ligne", { toast:true }); } catch (e3) {}
      _walMarkSynced(_walId);
      return { ok: true };
    }
    var onlineData = {
      collaborateur_id: appt.stId,
      date_rdv: appt.date,
      heure_rdv: appt.time,
      service_id: appt.sId,
      service_prix: appt.pr
      // 2026-10-11 : NI message NI items ici. En mémoire, appt.comment est un libellé construit
      // (« RDV EN LIGNE - nom - tel - message ») et appt.items a la forme de l'app : les réécrire
      // empilait le préfixe dans le message vu par le client et vidait les prestations du RDV.
    };
    // Calculer la nouvelle durée à partir des phases si disponible
    if (appt.aPhases && Array.isArray(appt.aPhases) && appt.aPhases.length) {
      var totalDur = 0;
      appt.aPhases.forEach(function(ph){ totalDur += (Number(ph.d) || 0); });
      if (totalDur > 0) onlineData.duree_minutes = totalDur;
    }
    // Resolve collab name pour info DB (utile à compte.html)
    var onlineCollabName = null;
    if (appt.stId && typeof gT === "function") { var st0 = gT(appt.stId); if (st0 && st0.n) onlineCollabName = st0.n; }
    if (onlineCollabName) onlineData.collaborateur_nom = onlineCollabName;
    // Recalculer service_nom si la prestation principale a changé
    if (appt.sId && typeof gS === "function") { var sv0 = gS(appt.sId); if (sv0 && sv0.n) onlineData.service_nom = sv0.n; }
    // 2026-10-11 : contenu modifié par l'établissement conservé (phases + prestations ajoutées/remplacées),
    // sinon tout revenait au catalogue au rechargement. Le nom vu par le client liste les ajouts.
    try {
      var _seItems = (Array.isArray(appt.items) ? appt.items : []).filter(function (x) { return x && !x.isAcompteData; });
      if ((Array.isArray(appt.aPhases) && appt.aPhases.length) || _seItems.length) {
        onlineData.salon_edit = { phases: (Array.isArray(appt.aPhases) && appt.aPhases.length) ? appt.aPhases : null, items: _seItems, at: new Date().toISOString() };
      }
      if (onlineData.service_nom) {
        var _ajouts = [];
        _seItems.forEach(function (x) { if ((x.addedDuringRdv || x.fromReplace || x.fromMultiSelect) && x.name && x.name !== onlineData.service_nom && _ajouts.indexOf(x.name) < 0) _ajouts.push(x.name); });
        if (_ajouts.length) onlineData.service_nom = (onlineData.service_nom + " + " + _ajouts.join(" + ")).slice(0, 200);
      }
    } catch (_eSe) {}
    // Tracking de la modif salon : on lit l'état actuel pour calculer le diff
    try {
      var oldRes = await _sb.from("rdv_online").select("date_rdv,heure_rdv,collaborateur_id,collaborateur_nom,duree_minutes,service_id,service_nom,service_prix,items,salon_modified_at,salon_modified_fields,salon_modified_acknowledged_by_client").eq("id", onlineUuid).eq("salon_id", _salonId).maybeSingle();
      if (oldRes && oldRes.data) {
        var old = oldRes.data;
        var diff = {};
        function diffField(key, oldVal, newVal) {
          if (newVal === undefined) return;
          var ov = oldVal == null ? null : oldVal;
          var nv = newVal == null ? null : newVal;
          // Normaliser heure (DB peut renvoyer "HH:MM:SS")
          if (typeof ov === "string" && ov.length >= 5 && key.indexOf("heure") >= 0) ov = ov.slice(0,5);
          if (typeof nv === "string" && nv.length >= 5 && key.indexOf("heure") >= 0) nv = nv.slice(0,5);
          if (String(ov) !== String(nv)) diff[key] = { old: ov, new: nv };
        }
        diffField("date_rdv", old.date_rdv, onlineData.date_rdv);
        diffField("heure_rdv", old.heure_rdv, onlineData.heure_rdv);
        diffField("collaborateur_id", old.collaborateur_id, onlineData.collaborateur_id);
        diffField("collaborateur_nom", old.collaborateur_nom, onlineData.collaborateur_nom);
        diffField("duree_minutes", old.duree_minutes, onlineData.duree_minutes);
        diffField("service_id", old.service_id, onlineData.service_id);
        diffField("service_nom", old.service_nom, onlineData.service_nom);
        diffField("service_prix", old.service_prix == null ? null : Number(old.service_prix).toFixed(2), onlineData.service_prix == null ? undefined : Number(onlineData.service_prix).toFixed(2));
        if (Object.keys(diff).length > 0) {
          // Le salon a réellement modifié le RDV : la demande de modification du client est traitée.
          onlineData.modification_demandee = false;
          onlineData.modification_status = null;
          onlineData.salon_modified_at = new Date().toISOString();
          // 2026-10-11 : modifications successives pas encore vues par le client -> on les CUMULE
          // (avant : la dernière écrasait la précédente, ex. prestation changée puis durée ajustée
          // -> le client ne voyait plus que « Durée »). Ancien = valeur d'origine, nouveau = actuelle.
          try {
            var _prev = (old.salon_modified_at && !old.salon_modified_acknowledged_by_client && old.salon_modified_fields && typeof old.salon_modified_fields === "object") ? old.salon_modified_fields : null;
            if (_prev) {
              var _m = {};
              Object.keys(_prev).forEach(function (k) { _m[k] = _prev[k]; });
              Object.keys(diff).forEach(function (k) { _m[k] = { old: (_m[k] ? _m[k].old : diff[k].old), new: diff[k].new }; });
              Object.keys(_m).forEach(function (k) { if (_m[k] && String(_m[k].old) === String(_m[k].new)) delete _m[k]; });
              diff = _m;
            }
          } catch (_eM) {}
          onlineData.salon_modified_fields = diff;
          onlineData.salon_modified_acknowledged_by_client = false;
          onlineData.salon_modified_acknowledged_at = null;
        }
      }
    } catch (eDiff) { console.warn("[saveAppointment online] diff calc skipped:", eDiff && eDiff.message); }
    try {
      var r = await _sb.from("rdv_online").update(onlineData).eq("id", onlineUuid).eq("salon_id", _salonId).select("id");
      // 2026-10-15 : 0 ligne modifiee (droits / RDV absent) = echec, comme une erreur
      if (r && !r.error && (!r.data || !r.data.length)) r = { error: { message: "aucune modification acceptée par le serveur" } };
      if (r && r.error) {
        console.warn("[saveAppointment online] update rdv_online failed:", r.error.message);
        try { if (typeof toast === "function") toast("La modification du rendez-vous en ligne n\u2019a pas pu \u00eatre enregistr\u00e9e : " + r.error.message, "error"); } catch (_t) {}
      } else {
        console.log("[saveAppointment online] rdv_online updated:", onlineUuid, onlineData.salon_modified_fields ? "(modif tracked)" : "(no diff)");
        _walMarkSynced(_walId); // 2026-10-11 : sinon rejoué à chaque démarrage (écrasait les changements d'un autre appareil)
        return { ok: true }; // 2026-10-14 (NF525) : succès confirmé pour la file de secours
      }
      return { ok: false, error: r && r.error }; // 2026-10-14 (NF525) : échec signalé à la file de secours (reste en file)
    } catch (e) { console.error("[saveAppointment online] exception:", e); return { ok: false, error: { message: String((e && e.message) || e) } }; }
  }

  // === RDV CLASSIQUE / TICKET : appointments table ===
  // Resolve client email and collab name for compte client lookup
  var clEmail = null, collabName = null;
  if (appt.cId && typeof gC === "function") { var cl = gC(appt.cId); if (cl && cl.em) clEmail = cl.em; }
  if (appt.stId && typeof gT === "function") { var st = gT(appt.stId); if (st && st.n) collabName = st.n; }
  // FIX 2026-05-13 : extrait le pass_type si cId est "passage-H/F/E" (preserve le genre choisi au reload)
  var _passType = null;
  if (appt.cId && typeof appt.cId === "string" && appt.cId.indexOf("passage-") === 0) {
    var _suffix = appt.cId.slice("passage-".length);
    if (_suffix === "H" || _suffix === "F" || _suffix === "E") _passType = _suffix;
  }
  var data = {
    salon_id: _salonId,
    // FIX 2026-05-12 : appt.cId est désormais toujours un UUID stable (U() utilise crypto.randomUUID).
    // Le filtre legacy length>30 est conservé en safety pour les "passage-F" / "online_xxx" etc.
    client_id: (appt.cId && appt.cId.indexOf("-") > 0 && appt.cId.length > 30) ? appt.cId : null,
    pass_type: _passType,  // FIX 2026-05-13 : persiste H/F/E pour les passages walk-in
    service_id: appt.sId, collab_id: appt.stId,
    date_rdv: appt.date, heure: appt.time, prix: appt.pr,
    heure_encaissement: appt.heureEncaiss || null,  // NF525 : heure reelle d'encaissement (distincte heure RDV)
    brut_total: appt.brutTotal || null, remise: appt.remise || 0,
    status: appt.st, mode_paiement: appt.met || "",
    ticket_num: appt.tkNum || null, hash: appt.hash || "",
    prev_hash: appt.prevHash || "", hash_algo: appt.hashAlgo || "",
    items: _lxItemsAvecAcompteEnLigne(appt), comment: appt.comment || "",
    a_phases: appt.aPhases || appt.phases || [],
    cancelled: appt.cancelled || false, cancel_reason: appt.cancelReason || "",
    // FIX 2026-07-11 : persiste les marqueurs du contre-ticket d'annulation (voir loader).
    // Un appointment normal ecrit is_cancel=false / contra_same_day=false (= defaut colonne)
    // -> aucun changement de comportement pour les tickets et RDV existants.
    is_cancel: appt.isCancel === true,
    cancel_ref: (appt.cancelRef != null ? String(appt.cancelRef) : null),
    contra_same_day: appt.contraSameDay === true,
    client_email: clEmail, collab_name: collabName,
    // FIX 2026-05-13 : persiste les détails de paiement (mode, montant, donné, rendu)
    // pour que le rendu monnaie réapparaisse sur les réimpressions et duplicatas.
    payments: (appt.payments && Array.isArray(appt.payments) && appt.payments.length > 0) ? appt.payments : null
  };
  try{data.clients=appt.clients||[];data.from_caisse=appt.fromCaisse||false;}catch(e){}
  // FIX 2026-07-11 : ne JAMAIS detruire un recu deja stocke.
  // Avant : `ticket_html: appt.ticketHtml || null` etait envoye a CHAQUE save, alors que le
  // loader ne remappait JAMAIS ticket_html -> apres un rechargement de l'app, appt.ticketHtml
  // est undefined -> toute re-sauvegarde d'un ticket scelle (reimpression, edition de
  // commentaire, correction de collaborateur) NULLifiait le recu stocke en base.
  // Desormais la colonne n'est envoyee QUE si on a reellement un HTML a ecrire ; sinon la cle
  // est omise du payload -> l'upsert PostgREST ne touche pas la colonne (valeur conservee).
  if (typeof appt.ticketHtml === "string" && appt.ticketHtml.length > 0) {
    data.ticket_html = appt.ticketHtml;
  }

  // FIX 2026-07-11 : persiste le RDV A DOMICILE (lieu + adresse) et le flag `printed`.
  // Les colonnes `lieu`, `adresse_domicile` et `printed` existent depuis toujours mais
  // n'etaient JAMAIS ecrites par saveAppointment -> le "RDV a domicile" (badge planning,
  // adresse + lien Maps sur la fiche) et le marquage "deja imprime" (banniere DUPLICATA sur
  // une reimpression) etaient perdus a chaque rechargement de l'app. Un salon mixte ou 100%
  // itinerant perdait donc l'info a chaque reload.
  // MEME GARDE-FOU que ticket_html / cancel_date : la cle n'est envoyee QUE si on a une valeur
  // reelle -> (a) le payload d'un RDV normal (en salon, jamais imprime) reste STRICTEMENT
  // INCHANGE, (b) une re-sauvegarde ne peut jamais NULLifier une valeur deja en base.
  // Aucun de ces 3 champs n'est protege par le trigger appointments_nf525_protect -> l'ecriture
  // reste acceptee meme sur une ligne scellee (cas reel : reimpression d'un ticket encaisse).
  if (appt.lieu) data.lieu = String(appt.lieu);
  if (appt.adresse) data.adresse_domicile = String(appt.adresse);
  if (appt.printed === true) data.printed = true;

  // FIX 2026-05-12 : upsert avec id explicite — plus de race condition local/UUID
  // FIX 2026-07-11 : persiste la DATE d annulation (colonne cancel_date, jusqu ici jamais ecrite).
  // Sans elle, TOUTES les vues du motif d annulation (bande Z section "Annulations", exports CSV/
  // Excel/archive annuel, bande mensuelle) sont muettes apres un rechargement : elles filtrent
  // toutes sur `a.cancelled && a.cancelDate` — or cancelDate n existait qu en memoire.
  // Valeur canonique = date METIER (TD, "YYYY-MM-DD") a 12:00 UTC : le loader relit les 10
  // premiers caracteres, donc la date reste juste quel que soit le fuseau de rendu (±12 h).
  // Ecrite UNIQUEMENT quand l appointment est annule -> payload d un ticket normal INCHANGE, et
  // aucune valeur existante ne peut etre ecrasee par un null (meme garde-fou que ticket_html).
  if (appt.cancelled && appt.cancelDate) {
    data.cancel_date = String(appt.cancelDate).slice(0, 10) + "T12:00:00Z";
  }

  // 2026-10-14 (NF525) : champs du TICKET perdus au rechargement (mémoire seule jusqu'ici) : opérateur, poste
  // de caisse, horodatage, clients supplémentaires, nom client figé, drapeaux acompte / retenue / annulation
  // d'acompte, référence du ticket d'origine, bons cadeaux utilisés. Ils sont regroupés dans la colonne
  // jsonb `meta` (cf. docs/sql_a_appliquer_nf525.sql). La clé n'est envoyée QUE si elle a un contenu, et
  // jamais si la colonne est absente (détection à la 1re erreur -> _lxApptMetaAbsent) : payload d'un RDV
  // ordinaire inchangé, application fonctionnelle même avant l'ajout de la colonne.
  var _meta = _lxApptMetaDepuis(appt);
  if (_meta && !window._lxApptMetaAbsent) data.meta = _meta;

  _ensureUuidId(appt);
  data.id = appt.id;
  var r = await _sb.from("appointments").upsert(data).select();
  if (r.error && data.meta && _lxErreurColonneMeta(r.error)) {
    // 2026-10-14 (NF525) : colonne meta pas encore créée en base -> on continue sans elle (mémorisé pour la session)
    window._lxApptMetaAbsent = true; delete data.meta;
    console.warn("[saveAppointment] colonne appointments.meta absente : champs de ticket non persistés (appliquer docs/sql_a_appliquer_nf525.sql)");
    r = await _sb.from("appointments").upsert(data).select();
  }
  if (r.error) {
    console.warn("saveAppointment upsert error, retry stripped:", r.error?.message);
    delete data.clients; delete data.from_caisse; delete data.client_email; delete data.collab_name;
    r = await _sb.from("appointments").upsert(data).select();
    // 2026-10-11 : ticket SCELLÉ (encaissé) -> seules les colonnes non protégées peuvent changer
    // (annulation, impression, commentaire...). En mémoire, le hash du ticket peut différer de celui
    // de la ligne (copie du hash de la table tickets après scellement) : l'upsert complet était alors
    // refusé et l'annulation du ticket original n'était PAS enregistrée (CA faux après rechargement).
    if (r.error && /inalterable/i.test(String(r.error.message || "")) && (appt.st === "done" || appt.tkNum)) {
      // 2026-10-14 audit (NF525) : jamais « cancelled:false » (ni motif vide) par-dessus une annulation déjà en base
      // (mémoire périmée d'un autre appareil) : l'annulation ne s'écrit que dans le sens false -> true.
      var _mut = {};
      if (appt.cancelled === true) { _mut.cancelled = true; _mut.cancel_reason = appt.cancelReason || ""; }
      if (appt.cancelled && appt.cancelDate) _mut.cancel_date = String(appt.cancelDate).slice(0, 10) + "T12:00:00Z";
      if (appt.printed === true) _mut.printed = true;
      if (typeof appt.ticketHtml === "string" && appt.ticketHtml.length > 0) _mut.ticket_html = appt.ticketHtml;
      if (typeof appt.comment === "string") _mut.comment = appt.comment;
      if (appt.lieu) _mut.lieu = String(appt.lieu);
      if (appt.adresse) _mut.adresse_domicile = String(appt.adresse);
      if (data.meta) _mut.meta = data.meta; // 2026-10-14 (NF525) : colonne non protégée (nouvelle), mise à jour autorisée sur un ticket scellé
      var _rm = await _sb.from("appointments").update(_mut).eq("id", appt.id).eq("salon_id", _salonId).select("id");
      if (_rm.error && _mut.meta) { if (_lxErreurColonneMeta(_rm.error)) window._lxApptMetaAbsent = true; delete _mut.meta; _rm = await _sb.from("appointments").update(_mut).eq("id", appt.id).eq("salon_id", _salonId).select("id"); }
      if (!_rm.error && (!_rm.data || !_rm.data.length)) _rm = { data: null, error: { message: "0 ligne mise à jour (droits ou session)", code: "LX_VIDE" } }; // 2026-10-14 audit
      if (!_rm.error && _rm.data && _rm.data.length) { _walMarkSynced(_walId); return _rm; }
      r = _rm.error ? _rm : r;
    }
    if (r.error) {
      console.error("saveAppointment retry failed:", r.error);
      // FIX 2026-08-25 (a) : DOUBLON PERMANENT (23505) -> ne JAMAIS re-tenter.
      // Un RDV refuse parce qu'il existe DEJA (meme client + collab + creneau) ne pourra
      // jamais s'inserer : on sort l'entree de la file WAL, sinon elle est rejouee a chaque
      // demarrage de l'app et spamme le monitoring en boucle (cas reel du 25/08, RDV
      // da15bcc1 rejoue 5 h apres avoir ete annule). Aucune perte : le RDV est deja en base.
      var _isDupPerm = (r.error.code === "23505") || ((r.error.message || "").indexOf("existe deja") >= 0);
      // FIX 2026-08-25 (b) : identifier le RDV dans l'alerte (client/date/heure). Sans ca,
      // impossible de savoir DE QUI il s'agit : l'entree n'atteint jamais la base.
      var _cliLabel = null;
      try {
        if (appt.cId && typeof gC === "function") {
          var _c = gC(appt.cId);
          if (_c) _cliLabel = ((_c.pre || "") + " " + (_c.nom || "")).trim();
        }
      } catch(_eCli){}
      try {
        if (typeof saveAuditEntry === "function") {
          saveAuditEntry("DB_ERROR", JSON.stringify({
            fn:"saveAppointment",
            msg: r.error.message || String(r.error),
            code: r.error.code || null,
            appt_id: appt.id || null,
            status: appt.st || null,
            client: _cliLabel || appt.cId || null,
            date: appt.date || null,
            heure: appt.time || null,
            collab_id: appt.stId || null,
            abandon: _isDupPerm
          }).slice(0,2000));
        }
      } catch(_){}
      // Doublon = echec DEFINITIF -> on marque l'entree WAL traitee pour stopper les rejeux.
      // Les autres erreurs (reseau, RLS...) restent rejouables : comportement inchange.
      if (_isDupPerm) { try { _walMarkSynced(_walId); } catch(_eW){} }
      // 2026-10-14 (NF525) : résultat explicite pour la file de secours (permanent = doublon, ne plus rejouer)
      return { ok: false, error: r.error, permanent: _isDupPerm };
    }
  }
  // 2026-10-14 audit : écriture « vide » (0 ligne renvoyée) = refus silencieux (droits / session) -> échec, reste en file
  if (!r || !r.data || !r.data.length) return { ok: false, error: { message: "0 ligne enregistrée (droits ou session)", code: "LX_VIDE" } };
  _walMarkSynced(_walId);
  return r; // 2026-10-14 (NF525) : succès confirmé (objet PostgREST sans .error)
}

// 2026-10-14 (NF525) : champs de ticket à conserver dans appointments.meta (jsonb), uniquement s'ils ont une valeur.
var _LX_APPT_META_KEYS = ["operator_id","operator_name","poste","ts","extraClients","clientNom","clientPrenom",
  "isAcompte","isAcompteCancel","apptId","isRetenue","retenueKey","retenueRdv","origTkNum","origTkNums",
  "bonVenduRemise","offertRemise","dbNum","bonsUtil", // 2026-10-28 (v6.7.0) : bons utilisés au modèle v2 (imputation, bon à usage multiple)
  "isAcompteEnLigne","acompteKey","acompteRdv","datePaiement","dateRemboursement","refundId", // 2026-10-14 (NF525 acompte en ligne)
  "lxEffets","lxEffetsAnnules","lxEffetsInverses","lxDoublonDe", // 2026-10-14 audit : effets de gestion d'un ticket (inversés à l'annulation), doublon d'acompte écarté
  "isRetour","retourRefId","retourRefTk","retourRefDate","retourMotif","lxEffetsRetour", // 2026-10-17 retour partiel
  "serveur","recetteKey","recetteType","ccCommandeId","ccNumero","bonCode","bonId","carteAboId","recetteRef","isRembEnLigne", "tkNumServeur",
  "reportJourClos","dateJournal","dateVente","heureVente","dateEnregistrement",
  "lxTva"]; // 2026-10-28 (6.8.5) : ventilation TVA figée du ticket (par taux et nature), copie de raw_data.lxTva (lecture des documents hors connexion) // 2026-10-28 (-5, v6.8.3) : heure réelle de vente / date d'enregistrement d'un ticket reporté // 2026-10-28 (-4, v6.8.2) : ticket reporté sur la journée ouverte (journée de vente déjà close) // 2026-10-28 (-3, v6.8.1) : n° de la série serveur ; (-2, v6.8.0) : tickets créés par le serveur (paiements en ligne) — ticket de retour partiel ci-dessus : ticket de retour (référence du ticket d'origine, motif, effets de gestion)
function _lxApptMetaDepuis(appt) {
  try {
    if (!appt || typeof appt !== "object") return null;
    var m = {}, n = 0;
    for (var i = 0; i < _LX_APPT_META_KEYS.length; i++) {
      var k = _LX_APPT_META_KEYS[i], v = appt[k];
      if (v === undefined || v === null || v === "" || v === false) continue;
      if (Array.isArray(v) && !v.length) continue;
      if (typeof v === "function") continue;
      m[k] = v; n++;
    }
    // poste de caisse : posé par saveTicketToDb (appelé APRÈS saveAppointment) -> on le reprend ici pour tout ticket scellé
    try { if (!m.poste && window.LX_POSTE && (appt.st === "done" || appt.tkNum)) { m.poste = window.LX_POSTE; n++; } } catch (_eP) {}
    return n ? m : null;
  } catch (_e) { return null; }
}
function _lxErreurColonneMeta(err) {
  try {
    var msg = String((err && (err.message || err.details)) || "");
    return /meta/i.test(msg) && (err.code === "PGRST204" || err.code === "42703" || /column|schema cache|colonne/i.test(msg));
  } catch (_e) { return false; }
}
// Mise à jour partielle de appointments.meta (fusion avec l'existant) : utilisée pour mémoriser dbNum
// après un NUM_MISMATCH sans réécrire le rendez-vous (une réécriture complète pourrait écraser un
// changement fait sur un autre appareil). Silencieuse si la colonne n'existe pas encore.
async function _lxApptMetaPatch(apptId, patch) {
  try {
    if (!_isOnline || !_salonId || !apptId || !patch || window._lxApptMetaAbsent) return false;
    if (!(typeof apptId === "string" && apptId.indexOf("-") > 0 && apptId.length > 30)) return false;
    var cur = await _sb.from("appointments").select("meta").eq("id", apptId).eq("salon_id", _salonId).maybeSingle();
    if (cur.error) { if (_lxErreurColonneMeta(cur.error)) window._lxApptMetaAbsent = true; return false; }
    if (!cur.data) return false;
    var m = (cur.data.meta && typeof cur.data.meta === "object") ? cur.data.meta : {};
    for (var k in patch) { if (Object.prototype.hasOwnProperty.call(patch, k) && patch[k] !== undefined) m[k] = patch[k]; }
    var up = await _sb.from("appointments").update({ meta: m }).eq("id", apptId).eq("salon_id", _salonId);
    if (up.error) { if (_lxErreurColonneMeta(up.error)) window._lxApptMetaAbsent = true; return false; }
    return true;
  } catch (_e) { return false; }
}
if (typeof window !== "undefined") window._lxApptMetaPatch = _lxApptMetaPatch;

// Supprimer un RDV non-encaissé de la base
// 2026-10-14 audit : résultat explicite {ok:...}, erreur VISIBLE (avant : console seulement -> le RDV revenait
// au rechargement sans que personne ne le sache), RDV marqué « supprimé » (jamais recréé par une sauvegarde ou
// un rejeu de la file de secours sur cet appareil).
async function deleteAppointmentFromDb(apptId) {
  if (!apptId) return { ok: false, error: { message: "identifiant absent" } };
  if (_lxEcrituresBloquees()) return { ok: false, skipped: true, reason: "lecture seule" };
  if (!_isOnline || !_salonId) {
    try { if (typeof toast === "function") toast("Hors ligne : la suppression du rendez-vous n’a pas pu être enregistrée.", "error"); } catch(_t) {}
    return { ok: false, skipped: true };
  }
  var _alerte = function(msg){ try { if (typeof toast === "function") toast("La suppression du rendez-vous n’a pas été enregistrée : " + msg + ". Il réapparaîtra au rechargement.", "error"); } catch(_t) {} };
  try {
    if (typeof apptId === "string" && apptId.indexOf("-") > 0 && apptId.length > 30) {
      var r = await _sb.from("appointments").delete().eq("id", apptId).eq("salon_id", _salonId).select("id");
      if (r.error) {
        console.error("[DEL APPT] Erreur:", r.error.message);
        _lxReportDbError("deleteAppointmentFromDb", r.error, { appt_id: apptId });
        try { await _lxControleSession(r.error, false); } catch(_eS) {}
        _alerte(r.error.message || "erreur serveur");
        return { ok: false, error: r.error };
      }
      if (!r.data || !r.data.length) {
        // 0 ligne : jamais enregistré, déjà supprimé ailleurs… ou session perdue (vérifiée ici)
        var _perdue = false; try { _perdue = await _lxControleSession(null, true); } catch(_eS2) {}
        if (_perdue) { _alerte("session expirée"); return { ok: false, sessionPerdue: true }; }
      }
      console.log("[DEL APPT] OK", apptId);
    }
    lxRdvMarquerSupprime(apptId);
    return { ok: true };
  } catch(e) {
    console.error("[DEL APPT] Exception:", e && e.message);
    _alerte((e && e.message) || "erreur");
    return { ok: false, error: { message: String((e && e.message) || e) } };
  }
}

// Sauvegarder un produit
// 2026-10-07 : mapper unique DB -> PRODS (+ reference pour la synchro entre appareils)
function lxMapProduitRow(p) {
  var o = (function(){ return {
        id: p.id, n: p.nom, p: Number(p.prix), pa: Number(p.prix_achat || 0),
        pamp: p.pamp != null ? Number(p.pamp) : null, pampQty: Number(p.pamp_qty || 0),
        cat: p.categorie, cb: p.code_barre, stk: p.stock, stkMin: p.stock_min,
        cc: p.coup_coeur, img: p.img || "",
        forSale: p.for_sale !== false, forUse: p.for_use || false,
        fournisseurId: p.fournisseur_id || null,
        datePeremption: p.date_peremption || null,
        paoMois: p.pao_mois || null,
        dateOuverture: p.date_ouverture || null,
        contenance: p.contenance || null,
        cbSupp: p.code_barre_supp || null,
        coefMulti: p.coef_multi != null ? Number(p.coef_multi) : null,
        tvaTaux: p.tva_taux != null ? Number(p.tva_taux) : null,
        promoActif: p.promo_actif || false,
        promoPrix: p.promo_prix != null ? Number(p.promo_prix) : null,
        promoDebut: p.promo_debut || null,
        promoFin: p.promo_fin || null,
        promoLabel: p.promo_label || null,
        description: p.description || null
      }; })();
  _lxPoserBase(o, _lxBaseDe(_lxProduitData(o)));
  return o;
}
if (typeof window !== "undefined") window.lxMapProduitRow = lxMapProduitRow;
function _lxNumOuNull(v) { if (v === null || v === undefined || v === "") return null; var n = Number(v); return isFinite(n) ? n : null; }
// 2026-10-07 : colonnes ecrites pour un produit (sans salon_id), depuis l'objet memoire.
function _lxProduitData(prod) {
  var data = {
    nom: prod.n, prix: prod.p, prix_achat: prod.pa || 0,
    pamp: prod.pamp != null ? prod.pamp : null,
    pamp_qty: prod.pampQty || 0,
    categorie: prod.cat, code_barre: prod.cb || "",
    stock: prod.stk, stock_min: prod.stkMin,
    coup_coeur: prod.cc || false, img: prod.img || "",
    for_sale: prod.forSale !== false, for_use: prod.forUse || false,
    fournisseur_id: prod.fournisseurId || null,
    date_peremption: prod.datePeremption || null,
    pao_mois: prod.paoMois || null,
    date_ouverture: prod.dateOuverture || null,
    contenance: prod.contenance || null,
    code_barre_supp: prod.cbSupp || null,
    // 2026-10-14 : 0 conserve (TVA 0 %, promo a 0, coef 0) ; seul vide / invalide -> null
    coef_multi: _lxNumOuNull(prod.coefMulti),
    tva_taux: _lxNumOuNull(prod.tvaTaux),
    promo_actif: prod.promoActif || false,
    promo_prix: _lxNumOuNull(prod.promoPrix),
    promo_debut: prod.promoDebut || null,
    promo_fin: prod.promoFin || null,
    promo_label: prod.promoLabel || null,
    description: prod.description || null
  };  return data;
}
function saveProduct(prod, opts) { return _lxEnFile("p:" + ((prod && prod.id) || "nouveau"), function(){ return _saveProductUneFois(prod, opts); }); }
async function _saveProductUneFois(prod, opts) {
  if (!_isOnline || !_salonId) return;
  var data = _lxProduitData(prod);
  data.salon_id = _salonId;

  if (typeof prod.id === "number" && prod.id > 0) {
    // Check if exists in Supabase
    var check = await _sb.from("produits").select("id").eq("id", prod.id).eq("salon_id", _salonId);
    if (check.data && check.data.length > 0) {
      // 2026-10-07 : fusion avec la version en base (stock et quantite PAMP par difference ;
      // un inventaire ecrit le stock compte tel quel : opts.stockAbsolu)
      if (prod._lxBase) {
        try {
          var _cur = await _sb.from("produits").select("*").eq("id", prod.id).eq("salon_id", _salonId).maybeSingle();
          if (!_cur.error && _cur.data) {
            var _mem = Object.assign({}, data); delete _mem.salon_id;
            var _confP = [];
            var _fus = _lxFusionFiche(prod._lxBase, _mem, _lxProduitData(lxMapProduitRow(_cur.data)),
              { compteurs:["stock","pamp_qty"], absolus:(opts && opts.stockAbsolu) ? ["stock"] : [], conflits:_confP });
            _lxSignalerConflits("Produit", prod.n, _confP);
            data = Object.assign({ salon_id: _salonId }, _fus);
          }
        } catch(_eF) {}
      }
      var _up = await _sb.from("produits").update(data).eq("id", prod.id).eq("salon_id", _salonId).select(); // 2026-10-15 : toujours limite au salon
      if (!_up.error && _up.data && _up.data[0]) {
        try { var _apres = lxMapProduitRow(_up.data[0]); Object.keys(_apres).forEach(function(k){ prod[k] = _apres[k]; }); _lxPoserBase(prod, _apres._lxBase); } catch(_eM) {}
        return { ok:true };
      } else if (_up.error) { try { _lxReportDbError("saveProduct", _up.error, { produit_id: prod.id }); } catch(_e) {} }
      // 2026-10-14 : echec affiche (le produit reste a l'ecran, l'utilisateur peut reessayer)
      _lxProduitAlerte(prod, _up.error ? _up.error.message : "aucune ligne modifi\u00e9e");
      return { ok:false, error:(_up.error && _up.error.message) || "aucune ligne modifiee" };
    } else if (check.error) {
      // 2026-10-14 : verification impossible -> on n'insere PAS (sinon doublon)
      _lxProduitAlerte(prod, check.error.message);
      return { ok:false, error:check.error.message };
    } else if (prod._lxBase) {
      // 2026-10-15 MULTI-APPAREILS : produit lu en base sur cet appareil puis disparu = supprime sur un autre
      // appareil. On ne le recree PLUS (avant : re-insertion silencieuse sous un nouvel identifiant).
      try {
        if (typeof PRODS !== "undefined" && Array.isArray(PRODS)) { for (var _ip = PRODS.length - 1; _ip >= 0; _ip--) { if (PRODS[_ip] && String(PRODS[_ip].id) === String(prod.id)) PRODS.splice(_ip, 1); } }
        var _mP = "\u26a0\ufe0f Le produit \u00ab " + (prod.n || "") + " \u00bb a \u00e9t\u00e9 supprim\u00e9 sur un autre appareil : la modification n'a pas \u00e9t\u00e9 enregistr\u00e9e (rien n'a \u00e9t\u00e9 recr\u00e9\u00e9). La liste a \u00e9t\u00e9 mise \u00e0 jour.";
        if (typeof showAlert === "function") showAlert(_mP, "warning"); else if (typeof toast === "function") toast(_mP, "warning");
        if (typeof saveAuditEntry === "function") saveAuditEntry("CONFLIT_SYNCHRO", JSON.stringify({ quoi: "produit", supprime_ailleurs: { id: prod.id, n: prod.n } }).slice(0, 2000));
        if (typeof refreshCurrentView === "function") refreshCurrentView();
        if (window._currentPage === "products" && typeof go === "function") go("products");
      } catch(_eS) {}
      return { ok:false, supprime:true, error:"produit supprim\u00e9 sur un autre appareil" };
    } else {
      var res = await _sb.from("produits").insert(data).select();
      if (res.data && res.data[0]) { prod.id = res.data[0].id; try { _lxPoserBase(prod, lxMapProduitRow(res.data[0])._lxBase); } catch(_e) {} return { ok:true }; }
      _lxProduitAlerte(prod, res.error ? res.error.message : "aucune ligne cr\u00e9\u00e9e");
      return { ok:false, error:(res.error && res.error.message) || "aucune ligne creee" };
    }
  } else {
    var res = await _sb.from("produits").insert(data).select();
    if (res.data && res.data[0]) { prod.id = res.data[0].id; try { _lxPoserBase(prod, lxMapProduitRow(res.data[0])._lxBase); } catch(_e) {} return { ok:true }; }
    _lxProduitAlerte(prod, res.error ? res.error.message : "aucune ligne cr\u00e9\u00e9e");
    return { ok:false, error:(res.error && res.error.message) || "aucune ligne creee" };
  }
}
function _lxProduitAlerte(prod, msg) {
  console.error("[saveProduct]", (prod && prod.n) || "", msg);
  try {
    var m = "\u26a0\ufe0f Produit \u00ab " + ((prod && prod.n) || "") + " \u00bb NON enregistr\u00e9 : " + (msg || "erreur") + ".\n\nIl reste affich\u00e9 sur cet appareil : r\u00e9essayez avant de fermer l'application.";
    if (typeof showAlert === "function") showAlert(m, "warning"); else if (typeof toast === "function") toast(m, "error");
  } catch(_e) {}
}

// 2026-10-28 (v6.7.0) : qualification TVA d'un bon (CGI art. 256 ter) relue de la colonne usage_tva / qualif_tva, ou, si la
// migration bons_cadeaux_tva.sql n'est pas encore appliquée, de l'entrée « qualification_tva » de l'historique du bon.
function _lxBonQualifLigne(g) {
  if (!g) return null;
  if (g.qualif_tva && typeof g.qualif_tva === "object") return g.qualif_tva;
  var h = Array.isArray(g.history) ? g.history : [];
  for (var i = 0; i < h.length; i++) { if (h[i] && h[i].type === "qualification_tva" && h[i].qualif) return h[i].qualif; }
  return null;
}
function _lxBonUsageLigne(g) {
  var u = g && (g.usage_tva || ((_lxBonQualifLigne(g) || {}).usage));
  return (u === "BUU" || u === "BUM") ? u : null;
}
window._lxBonQualifLigne = _lxBonQualifLigne; window._lxBonUsageLigne = _lxBonUsageLigne;

// Sauvegarder une carte cadeau
// FIX 2026-08-31 : le SOLDE d'un bon cadeau n'est plus ecrit depuis la memoire.
// Il l'etait, et la liste des bons n'est jamais rechargee apres l'ouverture de
// l'application : modifier la date d'expiration d'un bon depuis un appareil dont la
// memoire datait du matin remettait le solde a sa valeur d'origine — de l'argent
// offert, sans aucune trace. Le solde ne se modifie desormais que par les deux
// chemins qui en ont l'intention (consommation, annulation), via l'option
// {soldeIntentionnel:true} — la consommation passant elle-meme par une deduction
// atomique en base (consommer_bon_cadeau).
async function saveGiftCard(gc, opts) {
  // 2026-10-14 : echec signale a l'utilisateur ici (aucun appelant ne testait le resultat)
  if (!_isOnline || !_salonId) { if (_salonId) _lxBonAlerte(gc, "pas de connexion au serveur"); return { ok:false, error:"hors ligne" }; }
  var soldeIntentionnel = !!(opts && opts.soldeIntentionnel);
  var data = {
    salon_id: _salonId,
    valeur: gc.val, de: gc.from, pour: gc.to, message: gc.msg,
    code: gc.code, date_creation: gc.cr, date_expiration: gc.exp,
    scope: gc.scope || "tout",
    gc_num: gc.gcNum || null,
    pay_method: gc.payMethod || null,
    is_offert: gc.isOffert || false,
    ht: gc.ht || 0,
    tva: gc.tva || 0,
    tva_rate: (gc.usageTva === "BUM") ? 0 : (gc.tvaRate || 0.20),
    tk_num: gc.tkNum || null
  };
  // 2026-10-28 (v6.7.0) : qualification TVA écrite UNIQUEMENT pour un bon qualifié (bons antérieurs : colonnes non envoyées)
  var _qualif = (gc.usageTva === "BUU" || gc.usageTva === "BUM") ? (gc.qualifTva || { usage: gc.usageTva }) : null;
  if (_qualif) { data.usage_tva = gc.usageTva; data.qualif_tva = _qualif; }
  // FIX 2026-05-12 : upsert avec id explicite (U() génère UUID stable)
  _ensureUuidId(gc);
  data.id = gc.id;

  // Les champs de SOLDE ne partent que si l'appelant en a explicitement l'intention.
  // Sinon ils sont omis : la valeur en base fait foi, un etat perime ne peut plus
  // recrediter un bon deja consomme.
  var estNouveau = !gc._dejaEnBase;
  if (soldeIntentionnel || estNouveau) {
    data.utilise = gc.used || 0;
    data.restant = (typeof gc.rem === "number") ? gc.rem : gc.val;
    data.status  = gc.st || "active";
    data.history = gc.history || [];
  }

  var res = await _sb.from("cartes_cadeaux").upsert(data).select();
  // 2026-10-28 (v6.7.0) : colonnes usage_tva / qualif_tva absentes (migration non appliquée) -> qualification conservée dans
  // l'historique du bon (nouveau bon seulement : l'historique n'est écrit qu'à la création), puis nouvel essai.
  if (res.error && _qualif && /usage_tva|qualif_tva/.test(String(res.error.message || "") + " " + String(res.error.details || ""))) {
    delete data.usage_tva; delete data.qualif_tva;
    if (estNouveau) { var _h = (data.history || []).slice(); _h.unshift({ type: "qualification_tva", qualif: _qualif, date: gc.cr || null }); data.history = _h; gc.history = _h; }
    res = await _sb.from("cartes_cadeaux").upsert(data).select();
  }
  if (!res.error && (!res.data || !res.data.length)) res = { error: { message: "aucune modification accept\u00e9e par le serveur" } }; // 2026-10-15 : 0 ligne = echec
  if (res.error) { console.error("saveGiftCard upsert error:", res.error); _lxBonAlerte(gc, res.error.message); return { ok:false, error:res.error.message }; }
  gc._dejaEnBase = true;
  return { ok:true };
}
function _lxBonAlerte(gc, msg) {
  try { if (typeof showAlert === "function") showAlert("\u26a0\ufe0f Bon cadeau " + ((gc && gc.code) || "") + " NON enregistr\u00e9 : " + (msg || "erreur") + ".\n\nNotez le code et v\u00e9rifiez la liste des bons avant de fermer l'application.", "warning"); } catch(_e) {}
}

// Consommation ATOMIQUE d'un bon cadeau : la deduction est faite en base, jamais en
// memoire. Empeche qu'un meme bon soit depense deux fois depuis deux postes, et
// qu'un solde soit recalcule a partir d'une copie perimee.
async function consommerBonCadeau(bonId, montant, ticketNum) {
  if (!_isOnline || !_salonId) return { ok:false, error:"hors ligne" };
  try {
    var r = await _sb.rpc("consommer_bon_cadeau", {
      p_bon_id: bonId, p_montant: Number(montant), p_ticket: String(ticketNum || "")
    });
    if (r.error) { console.error("[bon cadeau]", r.error); return { ok:false, error:r.error.message }; }
    var d = r.data || {};
    if (!d.ok) return { ok:false, error:d.erreur || "refus", restant:d.restant };
    return { ok:true, restant:Number(d.restant), utilise:Number(d.utilise), status:d.status };
  } catch (e) {
    console.error("[bon cadeau]", e);
    return { ok:false, error:(e && e.message) || "erreur" };
  }
}
window.consommerBonCadeau = consommerBonCadeau;

// ============================================================
// TICKETS (NF525) — persistance DB avec hash chaîné
// ============================================================

// Map le mode de paiement local ("cb", "esp", "mixte-cb-esp", "cb+esp", etc.)
// vers {mode_paiement, detail_paiement} pour la DB
// FIX 2026-05-23 : ventilation correcte des paiements (NF525).
// AVANT : tout le total était collé sur le 1er mode détecté -> un acompte (payé en
// ligne ou en caisse) était ignoré (ex: 30€ marqués "espèces" alors que 5€ acompte
// en ligne + 25€ espèces), et les paiements mixtes étaient mal répartis.
// MAINTENANT : on ventile l'acompte (sous son mode) + le solde (tk.payments par mode).
function _mapPaymentBucket(label){
  var m = String(label||"").toLowerCase();
  if (m.indexOf("esp")>=0 || m.indexOf("cash")>=0) return "esp";
  if (m.indexOf("ch\u00e8q")>=0 || m.indexOf("cheq")>=0 || m.indexOf("chq")>=0) return "chq";
  if (m.indexOf("vir")>=0) return "vir";
  if (m.indexOf("bon")>=0 || m.indexOf("cadeau")>=0 || m.indexOf("avoir")>=0) return "bon";
  // FIX 2026-05-23 : paiement en ligne (Stripe / acompte en ligne) sur son propre poste,
  // distinct de la CB encaissee au salon (cf. compte 58010000 "Acomptes CB en ligne").
  if (m.indexOf("ligne")>=0 || m.indexOf("stripe")>=0 || m.indexOf("online")>=0) return "enligne";
  if (m.indexOf("cb")>=0 || m.indexOf("carte")>=0) return "cb";
  return "aut";
}
function _mapPayment(tk) {
  var detail = {};
  var total = Number(tk.pr || 0);
  function add(b, amt){
    amt = Math.round((Number(amt)||0)*100)/100;
    if (Math.abs(amt) < 0.005) return;          // ignore 0 (garde les négatifs = annulations)
    detail[b] = Math.round(((detail[b]||0) + amt)*100)/100;
  }
  // 1) Acompte déjà encaissé -> sous son propre mode.
  //    ACOMPTE EN LIGNE (Stripe) : INCHANGÉ. Aucun ticket NF525 n'a été scellé à la
  //    réservation -> l'acompte est un MODE DE RÈGLEMENT du ticket de prestation
  //    (compte 58010000), CA + TVA reconnus au jour de la prestation (validé comptable).
  //    ACOMPTE EN SALON (FIX 2026-07-11) : il a DÉJÀ son propre ticket scellé (+montant).
  //    Le ticket final ne book que le SOLDE via une ligne d'items négative
  //    « Acompte déjà versé (ticket #X) » (isAcompteDeduct) et porte acompte=0.
  //    Garde-fou : si une telle ligne est présente, on ne ré-ajoute JAMAIS l'acompte au
  //    détail de paiement (sinon Σ modes > recette du ticket -> clôture Z déséquilibrée).
  var acompte = Number(tk.acompte || 0);
  var _acNetted = false;
  try {
    var _its0 = tk.items || [];
    for (var _z = 0; _z < _its0.length; _z++) { if (_its0[_z] && _its0[_z].isAcompteDeduct) { _acNetted = true; break; } }
  } catch (_e0) {}
  if (!_acNetted && Math.abs(acompte) >= 0.005) add(_mapPaymentBucket(tk.acompteMode), acompte);
  // 2) Solde : liste détaillée des paiements si dispo, sinon (total - acompte) sur le mode de `met`
  if (Array.isArray(tk.payments) && tk.payments.length) {
    tk.payments.forEach(function(p){ add(_mapPaymentBucket(p.method || p.mode), p.amount); });
  } else {
    add(_mapPaymentBucket(tk.met || "cb"), _acNetted ? total : (total - acompte));
  }
  var keys = Object.keys(detail);
  if (keys.length === 0) { detail.aut = total; keys = ["aut"]; }
  return { mode: keys.length > 1 ? "mixte" : keys[0], detail: detail };
}

// Persiste un ticket (créé dans app.html via AP.push) vers la DB tickets.
// Safe à appeler plusieurs fois : check si le ticket existe déjà via (salon_id, num).
async function saveTicketToDb(tk) {
  if (!_isOnline || !_salonId || !tk) return null;
  if (_lxEcrituresBloquees()) return null; // 2026-10-14 audit : mode archives / établissement suspendu
  // WAL : persiste le ticket en LS AVANT tout traitement (filet 15/05/2026)
  var _walId = window._walBypass ? null : _walPersist("ticket", tk);
  try {
    var pay = _mapPayment(tk);
    var dateStr = tk.date || (function(){ var d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); })(); // 2026-10-11 : date locale (pas UTC)
    var timeStr = tk.heureEncaiss || tk.time || new Date().toTimeString().slice(0,5);
    if (timeStr.length === 5) timeStr = timeStr + ":00"; // HH:MM → HH:MM:SS

    // Calcul TVA à partir du taux salon
    var taux = lxTauxTVA();
    var ttc = Number(tk.pr || 0);
    var ht, tva;
    // Double taux (ex. Luxembourg : prestations 8% / produits 17%). Garde-fou :
    // si taux produits == taux services (France, Belgique, défaut) -> calcul mono-taux
    // STRICTEMENT inchangé (byte-identique). Sinon -> ventilation prestations/produits.
    var _txProd = (SALON_CONFIG.tvaProduits != null && Number(SALON_CONFIG.tvaProduits) !== taux) ? Number(SALON_CONFIG.tvaProduits) : taux;
    // 2026-10-14 audit : une ligne porte un taux PROPRE (produit à taux particulier, items[].tvaTaux, posé uniquement dans ce
    // cas à l'encaissement) -> HT / TVA calculés ligne à ligne (TTC du ticket réparti au prorata des lignes, comme la
    // ventilation prestations / produits ci-dessous). Format de l'empreinte serveur inchangé ; tickets existants non concernés.
    var _itsT = tk.items || [], _ligneTaux = false;
    for (var _j = 0; _j < _itsT.length; _j++) { if (_itsT[_j] && !_itsT[_j].isSep && _itsT[_j].tvaTaux != null && !isNaN(Number(_itsT[_j].tvaTaux))) { _ligneTaux = true; break; } }
    if (_ligneTaux && taux > 0) {
      var _parTaux = {}, _somme = 0;
      for (var _k = 0; _k < _itsT.length; _k++) {
        var _l = _itsT[_k]; if (!_l || _l.isSep) continue;
        var _sl = (Number(_l.price)||0) * (Number(_l.qty)||1) - (Number(_l.remise)||0);
        var _rl = (_l.tvaTaux != null && !isNaN(Number(_l.tvaTaux))) ? Number(_l.tvaTaux) : (_l.isProd ? _txProd : taux);
        _parTaux[_rl] = (_parTaux[_rl] || 0) + _sl; _somme += _sl;
      }
      if (Math.abs(_somme) > 0.004) {
        var _htT = 0, _reste = ttc, _cles = Object.keys(_parTaux);
        for (var _c = 0; _c < _cles.length; _c++) {
          var _ttcR = (_c === _cles.length - 1) ? _reste : Math.round(_parTaux[_cles[_c]] / _somme * ttc * 100) / 100;
          _reste = Math.round((_reste - _ttcR) * 100) / 100;
          _htT += Math.round(_ttcR / (1 + Number(_cles[_c]) / 100) * 100) / 100;
        }
        ht = Math.round(_htT * 100) / 100;
        tva = Math.round((ttc - ht) * 100) / 100;
      } else { _ligneTaux = false; }
    } else { _ligneTaux = false; }
    // 2026-10-28 (v6.7.0) : ticket au modèle bons v2 (vente de bon à usage multiple, hors champ de la TVA ; bon à usage unique
    // déduit des seules lignes couvertes) -> HT / TVA par la ventilation de l'application (_lxVentilV2), identique à la Z et aux
    // exports : la vente de BUM est HT = TTC, TVA 0. Ticket uniquement composé de ventes de BUM -> taux_tva 0 (« non soumis »).
    // Format de l'empreinte serveur inchangé. Tickets sans ligne BUM ni bonsUtil : calculs ci-dessous strictement inchangés.
    var _tauxCol = taux;
    // 2026-10-28 (Luxyra 6.8.5, règle TVA unique) : la ventilation du ticket (par taux et par nature, HT arrondi au centime par
    // taux, TVA = TTC − HT) est calculée UNE fois par l'application (lxTvaFiger, la même que le ticket imprimé) et mémorisée
    // dans raw_data.lxTva (hors empreinte ; raw_data figé par la base dès l'enregistrement, déclencheur a_lx_tickets_raw_data_fige ;
    // relue seulement après revalidation complète, _lxTvaValide) ; total_ht / total_tva = ses totaux ; taux_tva = taux des
    // prestations du ticket (0 si le ticket ne contient que des ventes de bons à usage multiple). Format de l'empreinte inchangé.
    // Application plus ancienne sans lxTvaFiger : calculs ci-dessous (inchangés).
    var _lxTvF = null;
    try { if (typeof window.lxTvaFiger === "function") _lxTvF = window.lxTvaFiger(tk); } catch (_eTvF) { _lxTvF = null; }
    if (_lxTvF && typeof _lxTvF.ht === "number" && typeof _lxTvF.tva === "number" && Math.abs(Math.round((_lxTvF.ht + _lxTvF.tva) * 100) / 100 - Math.round(ttc * 100) / 100) < 0.005) {
      ht = _lxTvF.ht; tva = _lxTvF.tva;
      _tauxCol = Number(_lxTvF.s) || 0;
      var _caF = Math.round((ttc - (Number(_lxTvF.hc) || 0)) * 100) / 100;
      if (Math.abs(Number(_lxTvF.hc) || 0) > 0.004 && Math.abs(_caF) < 0.005) _tauxCol = 0;
    }
    else if (typeof window._lxTicketV2 === "function" && typeof window._lxVentilV2 === "function" && window._lxTicketV2(tk)) {
      var _v2 = window._lxVentilV2(tk);
      ht = _v2.ht; tva = _v2.tva;
      if (Math.abs(_v2.horsCa) > 0.004 && Math.abs(_v2.ca) < 0.005) _tauxCol = 0;
    }
    else if (_ligneTaux) { /* HT / TVA déjà calculés ligne à ligne */ }
    else if (_txProd === taux) {
      ht = Math.round(ttc / (1 + taux/100) * 100) / 100;
      tva = Math.round((ttc - ht) * 100) / 100;
    } else {
      var _sumP = 0, _sumQ = 0, _its = tk.items || [];
      for (var _i = 0; _i < _its.length; _i++) {
        var _it = _its[_i]; if (!_it || _it.isSep) continue;
        var _sub = (Number(_it.price)||0) * (Number(_it.qty)||1) - (Number(_it.remise)||0);
        if (_it.isProd) _sumQ += _sub; else _sumP += _sub;
      }
      var _tot = _sumP + _sumQ;
      var _prodTTC = (_tot > 0) ? Math.round((_sumQ/_tot) * ttc * 100) / 100 : 0;
      var _prestTTC = Math.round((ttc - _prodTTC) * 100) / 100;
      var _htP = Math.round(_prestTTC / (1 + taux/100) * 100) / 100;
      var _htQ = Math.round(_prodTTC / (1 + _txProd/100) * 100) / 100;
      ht = Math.round((_htP + _htQ) * 100) / 100;
      tva = Math.round((ttc - ht) * 100) / 100;
    }

    // 2026-10-11 (NF525) : poste de caisse ayant enregistré le ticket (tous les chemins d'encaissement)
    try { if (!tk.poste && window.LX_POSTE) tk.poste = window.LX_POSTE; } catch(_eP){}
    // 2026-10-28 (-3, v6.8.1) : version de l'application qui TRANSMET le ticket (raw_data.lxVersion, hors empreinte) : contrôlée
    // par le serveur une fois les recettes en ligne activées (version minimale, refus LX_APP_OBSOLETE). Un ticket resté en file de
    // secours sur un appareil non mis à jour est transmis par la nouvelle version après rechargement (aucune vente perdue).
    try { if (typeof LX_VERSION !== "undefined" && LX_VERSION) tk.lxVersion = String(LX_VERSION); } catch(_eV){}
    var data = {
      salon_id: _salonId,
      // num : laisser le trigger auto-calculer
      date_ticket: dateStr,
      heure_ticket: timeStr,
      client_id: (typeof tk.cId === "string" && tk.cId.length === 36) ? tk.cId : null,
      client_nom: tk.clientNom || null,
      client_prenom: tk.clientPrenom || null,
      collaborateur_id: tk.stId || null,
      // FIX 2026-08-30 (NF525) : FIGER le nom de l'operateur dans le ticket.
      // tk.stNom n'etait renseigne que sur 1 des 7 chemins de creation de ticket ->
      // collaborateur_nom etait NULL sur 100% des tickets en base, et l'information
      // "qui a realise/encaisse" ne tenait QUE par la jointure sur collaborateur_id.
      // Si la fiche du collaborateur disparait, l'info fiscale est perdue. On resout
      // ici (point de passage unique de TOUS les tickets) plutot que sur chaque chemin.
      collaborateur_nom: tk.stNom || (function(){
        try{
          if(!tk.stId || typeof gT!=="function") return null;
          var _c = gT(tk.stId);
          return (_c && _c.n) ? _c.n : null;
        }catch(_e){ return null; }
      })() || null,
      items: tk.items || [],
      total_brut: Number(tk.brutTotal || tk.pr || 0),
      total_remise: Number(tk.remise || 0),
      total_ttc: ttc,
      total_ht: ht,
      total_tva: tva,
      taux_tva: _tauxCol,
      mode_paiement: pay.mode,
      detail_paiement: pay.detail,
      // 2026-10-28 (-8, Luxyra 6.8.6, constat M4 de l'audit) : un ticket entre TOUJOURS au journal comme ticket encaissé. Annulé
      // hors connexion avant sa transmission, il reste une vente : son contre-ticket (négatif) est un ticket à part, et la paire
      // s'annule dans la Z. Avant, « cancelled » le sortait du journal alors que le contre-ticket y était (Z refusée, FEC faux).
      // La base normalise aussi (déclencheur a_lx_tickets_0_statut) et fige le statut après l'enregistrement.
      status: "paid",
      notes: tk.comment || null,
      raw_data: tk  // backup complet pour réimpression fidèle
    };

    // FIX 2026-05-16 : protection IDEMPOTENCE pour les retry WAL.
    // Si un ticket avec ce hash existe DÉJÀ en DB → on ne réinsère pas (évite
    // les doublons quand un retry post-crash est tenté alors que l'INSERT
    // initial était déjà passé côté serveur).
    // Le hash est calculé côté app à partir de toutes les données critiques
    // du ticket (num, date, heure, prix, méthode, hash_prev, siret) → c'est
    // une clé unique fiable pour détecter un retry.
    // 2026-10-14 (NF525) : la clé d'idempotence PRINCIPALE est l'identifiant du ticket (raw_data->>id = tk.id,
    // même motif que raw_data->>retenueKey pour les retenues). Le hash ne suffisait pas : après l'insertion,
    // tk.hash est remplacé par le hash recalculé par le serveur (voir plus bas) alors que la copie conservée
    // dans la file de secours porte encore le hash calculé par l'application -> un rejeu ne retrouvait pas
    // le ticket et le réinsérait (doublon). Le contrôle par hash reste en second niveau.
    var _dejaEnBase = null;
    if (tk.id && typeof tk.id === "string" && tk.id.length >= 8) {
      try {
        var _exId = await _sb.from("tickets")
          .select("id, num, hash, hash_prev")
          .eq("salon_id", _salonId)
          .eq("raw_data->>id", tk.id)
          .limit(1).maybeSingle();
        if (_exId && _exId.data && _exId.data.id) _dejaEnBase = _exId.data;
      } catch (eIdId) { console.warn("[saveTicketToDb] contrôle d'idempotence (id) impossible :", eIdId && eIdId.message); }
    }
    if (!_dejaEnBase && tk.hash && typeof tk.hash === "string" && tk.hash.length >= 16) {
      try {
        var existingCheck = await _sb.from("tickets")
          .select("id, num, hash, hash_prev")
          .eq("salon_id", _salonId)
          .eq("hash", tk.hash)
          .limit(1).maybeSingle();
        if (existingCheck.data && existingCheck.data.id) _dejaEnBase = existingCheck.data;
      } catch (eIdem) {
        // Si le check plante, on continue normalement (best-effort)
        console.warn("[saveTicketToDb] idempotence check failed, fallback to INSERT:", eIdem?.message);
      }
    }
    if (_dejaEnBase) {
      console.log("[saveTicketToDb] Idempotence : ticket déjà en DB, skip insert. num=" + _dejaEnBase.num);
      tk.dbId = _dejaEnBase.id;
      if (!tk.tkNum) tk.tkNum = _dejaEnBase.num;
      tk.hashPrev = _dejaEnBase.hash_prev;
      delete tk._dbError;
      _walMarkSynced(_walId);
      return _dejaEnBase;
    }

    var res = await _sb.from("tickets").insert(data).select().single();
    // 2026-10-14 audit (NF525) : course sur la numérotation (deux postes au même instant -> même n° calculé par le
    // déclencheur) : refus 23505 sur tickets_num_per_salon -> UN nouvel essai immédiat (le déclencheur recalcule le
    // n° ; il est désormais aussi sérialisé par un verrou, cf. docs/migrations_1014/donnees.sql).
    if (res.error && res.error.code === "23505" && /tickets_num_per_salon/.test(String(res.error.message || "") + " " + String(res.error.details || ""))) {
      console.warn("[saveTicketToDb] n° de ticket pris par un autre poste : nouvel essai immédiat");
      var _dejaRetry = null;
      if (tk.id) try { var _exR = await _sb.from("tickets").select("id, num, hash, hash_prev").eq("salon_id", _salonId).eq("raw_data->>id", tk.id).limit(1).maybeSingle(); if (_exR && _exR.data && _exR.data.id) _dejaRetry = _exR.data; } catch(_eR) {}
      if (_dejaRetry) { tk.dbId = _dejaRetry.id; if (!tk.tkNum) tk.tkNum = _dejaRetry.num; tk.hashPrev = _dejaRetry.hash_prev; delete tk._dbError; _walMarkSynced(_walId); return _dejaRetry; }
      res = await _sb.from("tickets").insert(data).select().single();
    }
    if (res.error) { try { _lxControleSession(res.error, false); } catch(_eSs) {} } // 2026-10-14 audit : session perdue -> reconnexion
    if (res.error && res.error.code === "23505" && tk.retenueKey) {
      // 2026-10-14 (NF525) : retenue déjà enregistrée par un autre appareil (index unique raw_data->>retenueKey)
      // -> même événement économique déjà en base : on reprend la ligne existante (pas de doublon, pas de rejeu).
      try {
        var _exRk = await _sb.from("tickets").select("id, num, hash, hash_prev").eq("salon_id", _salonId).eq("raw_data->>retenueKey", tk.retenueKey).limit(1).maybeSingle();
        if (_exRk && _exRk.data && _exRk.data.id) {
          tk.dbId = _exRk.data.id; if (!tk.tkNum) tk.tkNum = _exRk.data.num; tk.hashPrev = _exRk.data.hash_prev;
          delete tk._dbError; _walMarkSynced(_walId);
          return _exRk.data;
        }
      } catch(_eRk){}
    }
    if (res.error && res.error.code === "23505" && tk.acompteKey) {
      // 2026-10-14 (NF525 acompte en ligne) : ticket d'acompte en ligne / de remboursement déjà enregistré par un autre
      // appareil (index unique raw_data->>acompteKey) -> même événement économique déjà en base : on reprend la ligne.
      try {
        var _exAk = await _sb.from("tickets").select("id, num, hash, hash_prev, rid:raw_data->>id, tkNumSrv:raw_data->tkNum").eq("salon_id", _salonId).eq("raw_data->>acompteKey", tk.acompteKey).limit(1).maybeSingle();
        if (_exAk && _exAk.data && _exAk.data.id) {
          // 2026-10-14 audit : le ticket en base est celui d'un AUTRE appareil (verrou repris après 15 min, file de secours
          // rejouée) -> le ticket local est un DOUBLON jamais entré au journal : il est écarté de la caisse (mémoire + rendez-vous
          // local neutralisé, hors CA) et le ticket du serveur est rechargé. Le ticket local ne reçoit JAMAIS le n° du serveur.
          if (_exAk.data.rid && _exAk.data.rid !== tk.id) {
            delete tk._dbError; _walMarkSynced(_walId);
            try { if (typeof window._lxAcompteDoublonEcarter === "function") window._lxAcompteDoublonEcarter(tk, _exAk.data); } catch (_eDb) {}
            var _rowSrv = { id: _exAk.data.id, num: _exAk.data.num, hash: _exAk.data.hash, hash_prev: _exAk.data.hash_prev, doublon: true, raw_data: { id: _exAk.data.rid, tkNum: _exAk.data.tkNumSrv } };
            return _rowSrv;
          }
          tk.dbId = _exAk.data.id; if (!tk.tkNum) tk.tkNum = _exAk.data.num; tk.hashPrev = _exAk.data.hash_prev;
          delete tk._dbError; _walMarkSynced(_walId);
          return _exAk.data;
        }
      } catch(_eAk){}
    }
    // 2026-10-17 retour partiel : refus DÉFINITIF du garde-fou serveur des retours (docs/migrations_1017/retour_partiel.sql) :
    // retour dépassant le payé, ticket d'origine annulé / introuvable, avoir sur un ticket déjà remboursé en partie… Ce refus ne
    // change pas avec le temps : l'entrée sort de la file de secours (trace WAL_ABANDON + DB_ERROR critique), jamais rejouée.
    // L'appelant reçoit {refusDefinitif:true} (le retour partiel n'affiche alors aucun ticket ; voir lxRetourValider).
    // 2026-10-28 (-2, v6.8.0) : commande Click & Collect payée en ligne DÉJÀ en caisse (ticket créé par le serveur au paiement) :
    // le ticket de remise d'une ancienne version de l'application est refusé définitivement (jamais rejoué, pas de double CA).
    // 2026-10-28 (-3, v6.8.1) : version trop ancienne (seuil relevé par le serveur) -> le ticket RESTE en file de secours
    // (transmis après mise à jour), message clair « mettez l'application à jour ».
    if (res.error && /LX_APP_OBSOLETE/.test(String(res.error.message || ""))) {
      try { tk._dbError = { at: new Date().toISOString(), msg: String(res.error.message || ""), code: "LX_APP_OBSOLETE" }; } catch(_eO0){}
      try { if (typeof saveAuditEntry === "function") saveAuditEntry("DB_ERROR", JSON.stringify({ fn: "saveTicketToDb", gravite: "critical", code: "LX_APP_OBSOLETE", msg: String(res.error.message || "").slice(0, 300), tk_num: tk.tkNum || null }).slice(0, 2000)); } catch(_eO1){}
      try { if (typeof window.lxAppObsolete === "function") window.lxAppObsolete(String(res.error.message || "")); } catch(_eO2){}
      return null;
    }
    // 2026-10-28 (-3) : n° de la série du serveur (900001+) : jamais attribué par un appareil -> refus définitif, alerte
    if (res.error && /LX_TKNUM_SERIE_SERVEUR/.test(String(res.error.message || ""))) {
      try { tk._dbError = { at: new Date().toISOString(), msg: String(res.error.message || ""), code: "LX_TKNUM_SERIE_SERVEUR", permanent: true }; } catch(_eT0){}
      try { if (typeof saveAuditEntry === "function") saveAuditEntry("DB_ERROR", JSON.stringify({ fn: "saveTicketToDb", gravite: "critical", code: "LX_TKNUM_SERIE_SERVEUR", msg: String(res.error.message || "").slice(0, 300), tk_num: tk.tkNum || null, tk_id: tk.id || null }).slice(0, 2000)); } catch(_eT1){}
      try { if (typeof showAlert === "function") showAlert("Ticket n°" + (tk.tkNum || "?") + " NON enregistré : ce n° est réservé aux paiements en ligne. Rechargez l'application puis refaites l'encaissement.", "error"); } catch(_eT2){}
      return null;
    }
    if (res.error && /LX_CC_DEJA_EN_CAISSE/.test(String(res.error.message || ""))) {
      try { tk._dbError = { at: new Date().toISOString(), msg: String(res.error.message || ""), code: "LX_CC_DEJA_EN_CAISSE", permanent: true }; } catch(_eC0){}
      if (_walId) { _walMarkSynced(_walId); try { if (typeof saveAuditEntry === "function") saveAuditEntry("WAL_ABANDON", JSON.stringify({ wal_id: _walId, type: "ticket", raison: "commande déjà en caisse (ticket serveur)", msg: String(res.error.message || "").slice(0, 300), tk_num: tk.tkNum || null }).slice(0, 2000)); } catch(_eC1){} }
      try { if (typeof saveAuditEntry === "function") saveAuditEntry("DB_ERROR", JSON.stringify({ fn: "saveTicketToDb", gravite: "critical", msg: String(res.error.message || "").slice(0, 400), code: "LX_CC_DEJA_EN_CAISSE", tk_num: tk.tkNum || null, tk_id: tk.id || null }).slice(0, 2000)); } catch(_eC2){}
      try { if (typeof toast === "function") toast(String(res.error.message || "").replace(/^.*LX_CC_DEJA_EN_CAISSE\s*:?\s*/, ""), "error"); } catch(_eC3){}
      // 2026-10-28 (-3, constat MAJEUR 6) : le rendez-vous / ticket local de cette remise est retiré de la caisse (jamais compté :
      // la base refuse aussi sa copie dans appointments) et l'opérateur est prévenu que le ticket imprimé est sans valeur.
      try { if (typeof window._lxCcDoublonEcarter === "function") window._lxCcDoublonEcarter(tk, String(res.error.message || "")); } catch(_eC4){}
      return { ok: false, refusDefinitif: true, error: { message: String(res.error.message || ""), code: res.error.code || "P0001" } };
    }
    if (res.error && /LX_RETOUR_REFUSE/.test(String(res.error.message || ""))) {
      try { tk._dbError = { at: new Date().toISOString(), msg: String(res.error.message || ""), code: "LX_RETOUR_REFUSE", permanent: true }; } catch(_eF0){}
      if (_walId) {
        _walMarkSynced(_walId);
        try { if (typeof saveAuditEntry === "function") saveAuditEntry("WAL_ABANDON", JSON.stringify({ wal_id: _walId, type: "ticket", raison: "refus définitif du serveur (retour / avoir)", msg: String(res.error.message || "").slice(0, 300), tk_num: tk.tkNum || null, tk_id: tk.id || null }).slice(0, 2000)); } catch(_eA0){}
      }
      try { if (typeof saveAuditEntry === "function") saveAuditEntry("DB_ERROR", JSON.stringify({ fn: "saveTicketToDb", gravite: "critical", msg: String(res.error.message || "").slice(0, 400), code: "LX_RETOUR_REFUSE", tk_num: tk.tkNum || null, tk_id: tk.id || null, tk_total: tk.pr || null }).slice(0, 2000)); } catch(_eA1){}
      // 2026-10-17 retour partiel (audit) : rejeu (file de secours) d'un ticket de retour déjà ajouté à la caisse -> écarté de la caisse
      // (sinon la Z de l'appareil et la clôture de nuit, calculées sur les rendez-vous, différeraient du journal). Sans effet au 1er envoi.
      try { if (typeof window._lxRetourRefuseEcarter === "function") window._lxRetourRefuseEcarter(tk, String(res.error.message || "")); } catch(_eRe){}
      return { ok: false, refusDefinitif: true, error: { message: String(res.error.message || ""), code: res.error.code || "P0001" } };
    }
    // 2026-10-28 (-4, v6.8.2, contre-audit BLOQUANT) : journée de VENTE déjà clôturée (Z faite par un autre poste ou par la
    // clôture de nuit pendant que ce ticket attendait : réseau, ancienne version refusée LX_APP_OBSOLETE…). La Z scellée n'est
    // jamais rouverte ni modifiée (BOI-TVA-DECLA-30-10-30 § 80-100, § 170) et la vente ne doit jamais être perdue (§ 50, § 75) :
    // elle est enregistrée sur la journée OUVERTE (jour de sa transmission), sa date et son heure réelles de vente en mention
    // (raw_data.dateVente / heureVente, notes), comme les paiements en ligne reportés par le serveur. Une seule fois (même
    // identifiant raw_data.id : index d'unicité). Journée du jour elle aussi close -> l'entrée reste en file (jour suivant).
    if (res.error && /cl[oô]tur[eé]e/i.test(String(res.error.message || "")) && /NF525|LX_JOUR_CLOS/.test(String(res.error.message || ""))) {
      var _rep = await _lxTicketReporter(tk, data, dateStr, timeStr, res.error, _walId);
      if (_rep && _rep.data) return _rep.data;
      if (_rep && _rep.error) res = { error: _rep.error };
    }
    if (res.error) {
      console.warn("[saveTicketToDb] insert error", res.error);
      // 2026-10-14 (NF525) : l'opérateur est prévenu (avant : simple console.warn, invisible en caisse)
      // et le ticket porte la trace de l'échec (tk._dbError) ; la file de secours le retransmettra.
      try { tk._dbError = { at: new Date().toISOString(), msg: String(res.error.message || res.error), code: res.error.code || null }; } catch(_eF){}
      try { if (typeof toast === "function") toast("Ticket #" + (tk.tkNum || "?") + " non transmis au serveur : " + String(res.error.message || "erreur") + ". Il est conservé sur cet appareil et sera retransmis.", "error"); } catch(_eT){}
      // FIX 2026-05-15 : log DB_ERROR pour monitoring admin (trigger envoie mail temps réel)
      try {
        if (typeof saveAuditEntry === "function") {
          saveAuditEntry("DB_ERROR", JSON.stringify({
            fn:"saveTicketToDb",
            msg: res.error.message || String(res.error),
            code: res.error.code || null,
            hint: res.error.hint || null,
            tk_num: tk.tkNum || null,
            tk_total: tk.pr || null,
            tk_id: tk.id || null
          }).slice(0,2000));
        }
      } catch(_){}
      // WAL non marqué synced → récupération au prochain boot via popup (puis alerte après plusieurs échecs).
      // NB 2026-10-14 : un 23505 sur un ticket ordinaire n'est PAS traité comme « déjà en base » (le contrôle
      // par raw_data->>id ci-dessus l'aurait trouvé) : l'entrée reste en file et l'opérateur est alerté.
      return null;
    }
    // Mettre à jour l'objet local avec le num généré par le trigger + l'id + le hash
    if (res.data) {
      tk.dbId = res.data.id;
      // 2026-10-14 (NF525) : le n° attribué par le serveur peut différer du n° imprimé (tkNum) si deux postes
      // ont numéroté en même temps. Le ticket imprimé n'est JAMAIS renuméroté : on conserve le n° serveur
      // (tk.dbNum, persisté dans appointments.meta) et on trace l'écart (audit NUM_MISMATCH).
      if (tk.tkNum && res.data.num != null && Number(res.data.num) !== Number(tk.tkNum)) {
        tk.dbNum = res.data.num;
        try {
          if (typeof saveAuditEntry === "function") {
            saveAuditEntry("NUM_MISMATCH", JSON.stringify({ fn:"saveTicketToDb", tk_num_imprime: tk.tkNum, num_serveur: res.data.num, tk_id: tk.id || null, date: dateStr, total: ttc }).slice(0,2000));
          }
        } catch(_eN){}
        try { _lxApptMetaPatch(tk.id, { dbNum: res.data.num }); } catch(_eP){}
      }
      if (!tk.tkNum) tk.tkNum = res.data.num;
      tk.hash = res.data.hash;
      tk.hashPrev = res.data.hash_prev;
    }
    delete tk._dbError;
    _walMarkSynced(_walId);
    return res.data;
  } catch (e) {
    console.error("[saveTicketToDb] unexpected", e);
    try {
      if (typeof saveAuditEntry === "function") {
        saveAuditEntry("DB_ERROR", JSON.stringify({
          fn:"saveTicketToDb",
          msg:"EXCEPTION: "+ (e.message || String(e)),
          tk_id: tk && tk.id || null
        }).slice(0,2000));
      }
    } catch(_){}
    return null;
  }
}

// 2026-10-28 (-4, v6.8.2) : enregistrement de REPORT d'un ticket dont la journée de vente est déjà clôturée (voir saveTicketToDb).
// Retourne {data} (enregistré, ou déjà enregistré par un essai précédent), {error} (refus d'une autre nature) ou null (journée
// du jour close aussi : nouvel essai le lendemain). Le ticket imprimé n'est jamais renuméroté (même n° imprimé tkNum).
function _lxJourLocal(){ var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function _lxDateFr(j){ var p = String(j || "").slice(0, 10).split("-"); return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : String(j || ""); }
async function _lxTicketReporter(tk, data, dateStr, timeStr, err, walId) {
  try {
    var jr = _lxJourLocal();
    if (!(jr > String(dateStr).slice(0, 10))) {
      try { tk._dbError = { at: new Date().toISOString(), msg: String(err && err.message || ""), code: "LX_JOUR_CLOS_ATTENTE" }; } catch(_e0) {}
      return null; // la journée du jour est elle-même close : on attend la journée suivante (l'entrée reste en file)
    }
    var hv = String(timeStr || "").slice(0, 5);
    var mention = "Vente du " + _lxDateFr(dateStr) + (hv ? " à " + hv : "") + " (ticket n°" + (tk.tkNum || "?") + ") enregistrée le " + _lxDateFr(jr) +
      " : journée de vente déjà clôturée (Z) lors de sa transmission";
    var raw = Object.assign({}, tk);
    delete raw._dbError; delete raw.ticketHtml;
    raw.reportJourClos = true; raw.dateVente = String(dateStr).slice(0, 10); raw.heureVente = hv || null; raw.dateEnregistrement = jr; raw.reportMention = mention;
    // 2026-10-28 (-5, v6.8.3, contre-audit final constat 4) : la date et l'heure RÉELLES de vente sont SCELLÉES : portées par la
    // 1re ligne du ticket (items[0].lxRep, version 1), champ couvert par l'empreinte du serveur (num|date|heure|ttc|ht|items|prev|salon,
    // format inchangé) et par le sceau ; raw_data n'en est qu'une copie (hors empreinte). La base refuse un ticket reporté sans
    // cette ligne cohérente (LX_REPORT_NON_SCELLE). Tickets non reportés : lignes inchangées.
    var _its = Array.isArray(data.items) ? data.items.map(function(x){ return (x && typeof x === "object") ? Object.assign({}, x) : x; }) : [];
    if (!_its.length || !_its[0] || typeof _its[0] !== "object") _its.unshift({ name: "", price: 0, qty: 0, isSep: true });
    _its[0] = Object.assign({}, _its[0], { lxRep: { v: 1, type: "vente", dateVente: String(dateStr).slice(0, 10), heureVente: hv || null, dateEnr: jr } });
    var d2 = Object.assign({}, data, { date_ticket: jr, heure_ticket: new Date().toTimeString().slice(0, 8), notes: (data.notes ? String(data.notes) + " — " : "") + mention, raw_data: raw, items: _its });
    var r2 = await _sb.from("tickets").insert(d2).select().single();
    if (r2.error && r2.error.code === "23505") {
      // déjà enregistré (essai précédent dont la réponse a été perdue) : on reprend la ligne existante
      try { var ex = await _sb.from("tickets").select("id, num, hash, hash_prev, date_ticket").eq("salon_id", _salonId).eq("raw_data->>id", tk.id).limit(1).maybeSingle(); if (ex && ex.data && ex.data.id) r2 = { data: ex.data, error: null }; } catch(_eX) {}
    }
    if (r2.error) {
      if (/cl[oô]tur[eé]e/i.test(String(r2.error.message || ""))) return null; // journée du jour close entre-temps : demain
      return { error: r2.error };
    }
    tk.dbId = r2.data.id; if (r2.data.hash) tk.hash = r2.data.hash; if (r2.data.hash_prev !== undefined) tk.hashPrev = r2.data.hash_prev;
    tk.reportJourClos = true; tk.dateJournal = jr; tk.dateVente = String(dateStr).slice(0, 10);
    delete tk._dbError;
    _walMarkSynced(walId);
    try { var _l = (typeof AP !== "undefined" && Array.isArray(AP)) ? AP : null; if (_l) for (var i = 0; i < _l.length; i++) { if (_l[i] && _l[i].id === tk.id) { _l[i].reportJourClos = true; _l[i].dateJournal = jr; _l[i].dateVente = tk.dateVente; } } } catch(_eA) {}
    tk.heureVente = hv || null; tk.dateEnregistrement = jr;
    try { var _l2 = (typeof AP !== "undefined" && Array.isArray(AP)) ? AP : null; if (_l2) for (var j = 0; j < _l2.length; j++) { if (_l2[j] && _l2[j].id === tk.id) { _l2[j].heureVente = hv || null; _l2[j].dateEnregistrement = jr; } } } catch(_eA2) {}
    try { _lxApptMetaPatch(tk.id, { reportJourClos: true, dateJournal: jr, dateVente: tk.dateVente, heureVente: hv || null, dateEnregistrement: jr }); } catch(_eP) {}
    try { if (typeof saveAuditEntry === "function") saveAuditEntry("TICKET_REPORTE_JOUR_CLOS", JSON.stringify({ tk_num: tk.tkNum || null, tk_id: tk.id || null, num_serveur: r2.data.num, date_vente: tk.dateVente, heure_vente: hv, date_enregistrement: jr, total: Number(tk.pr || 0), motif: String(err && err.message || "").slice(0, 200) }).slice(0, 2000)); } catch(_eS) {}
    try { if (typeof toast === "function") toast("Ticket #" + (tk.tkNum || "?") + " du " + _lxDateFr(dateStr) + " enregistré aujourd'hui : sa journée était déjà clôturée (date réelle de vente conservée).", "warning"); } catch(_eT) {}
    return { data: r2.data };
  } catch (e) { return { error: { message: (e && e.message) || String(e) } }; }
}
if (typeof window !== "undefined") window._lxTicketReporter = _lxTicketReporter;

// 2026-10-28 (-8, Luxyra 6.8.6, constat M4) : RETIRÉE. Elle passait un ticket encaissé en status « cancelled » (il sortait du
// journal de la Z et du FEC) ; elle n'avait aucun appel. Une annulation est TOUJOURS un contre-ticket (bouton « Annuler » :
// _cancelSecureTicketDo) ; la base refuse désormais toute modification du statut d'un ticket enregistré
// (LX_TICKET_COLONNES_FIGEES). Conservée sans effet pour les appels éventuels d'anciennes pages.
async function cancelTicketDb(ticketDbId, reason) {
  console.warn("[cancelTicketDb] sans effet depuis 6.8.6 : une annulation est un contre-ticket", ticketDbId, reason || "");
}

// Verrouille tous les tickets d'une clôture (post-clôture Z).
// FIX 2026-05-19 : propage les erreurs (plus de catch silencieux) + retourne le
// count de tickets effectivement modifiés. L'appelant peut vérifier que tous
// les tickets attendus ont bien été verrouillés (audit NF525).
async function lockTicketsForCloture(cloture) {
  if (!_isOnline) throw new Error("Mode offline — verrouillage différé");
  if (!_salonId) throw new Error("salon_id manquant pour lockTicketsForCloture");
  if (!cloture) throw new Error("cloture argument manquant");
  if (!cloture.date) throw new Error("cloture.date manquante");
  var res = await _sb.from("tickets")
    .update({ locked: true, cloture_id: cloture.id || null })
    .eq("salon_id", _salonId)
    .eq("date_ticket", cloture.date)
    .eq("locked", false)
    .select("id, num");
  if (res.error) {
    throw new Error("UPDATE tickets locked failed: " + res.error.message + (res.error.code ? " ["+res.error.code+"]" : ""));
  }
  var tickets = res.data || [];
  return { nbModified: tickets.length, tickets: tickets };
}

// ============================================================
// DEVIS — persistance DB
// ============================================================

async function saveDevisToDb(dv) {
  if (!_isOnline || !_salonId || !dv) return null;
  try {
    var taux = lxTauxTVA();
    var ttc = Number(dv.total || 0);
    var ht = Math.round(ttc / (1 + taux/100) * 100) / 100;
    var tva = Math.round((ttc - ht) * 100) / 100;

    var data = {
      salon_id: _salonId,
      date_devis: dv.date || new Date().toISOString().slice(0,10),
      client_id: (typeof dv.cId === "string" && dv.cId.length === 36) ? dv.cId : null,
      client_nom: dv.clientNom || dv.clientName || null,
      client_prenom: dv.clientPrenom || null,
      client_tel: dv.clientTel || null,
      client_email: dv.clientEmail || null,
      items: dv.items || [],
      total_brut: Number(dv.totalBrut || dv.total || 0),
      total_remise: Number(dv.remise || 0),
      total_ttc: ttc,
      total_ht: ht,
      total_tva: tva,
      taux_tva: taux,
      status: dv.status || "brouillon",
      validite_jours: dv.validiteJours || (Number(SALON_CONFIG.validiteDevis) > 0 ? Number(SALON_CONFIG.validiteDevis) : 30),
      notes: dv.notes || null,
      collaborateur_id: dv.stId || null,
      collaborateur_nom: dv.stNom || null,
      raw_data: dv
    };

    if (dv.dbId) {
      // Update existant
      var upd = await _sb.from("devis").update(data).eq("id", dv.dbId).select().single();
      if (upd.error) { window._lxDerniereErreurEcriture = upd.error.message; _lxReportDbError("saveDevisToDb.update", upd.error); console.warn("[saveDevisToDb] update error", upd.error); return null; }
      return upd.data;
    } else {
      var ins = await _sb.from("devis").insert(data).select().single();
      if (ins.error) { window._lxDerniereErreurEcriture = ins.error.message; _lxReportDbError("saveDevisToDb.insert", ins.error); console.warn("[saveDevisToDb] insert error", ins.error); return null; }
      if (ins.data) {
        dv.dbId = ins.data.id;
        if (!dv.num) dv.num = ins.data.num;
        dv.dateValidite = ins.data.date_validite;
      }
      return ins.data;
    }
  } catch (e) {
    console.error("[saveDevisToDb] unexpected", e);
    window._lxDerniereErreurEcriture = (e && e.message) || "probl\u00e8me de connexion";
    return null;
  }
}

async function updateDevisStatus(devisDbId, newStatus, ticketDbId) {
  if (!_isOnline || !devisDbId) return;
  try {
    var patch = { status: newStatus };
    if (ticketDbId) patch.ticket_id = ticketDbId;
    // 2026-10-15 : resultat verifie + alerte (avant : echec muet)
    return await lxEcritureVerifiee(_sb.from("devis").update(patch).eq("id", devisDbId).select("id"), "statut du devis", { toast:true });
  } catch (e) { console.warn("[updateDevisStatus]", e); }
}

async function deleteDevisDb(devisDbId) {
  if (!_isOnline || !devisDbId) return;
  try {
    return await lxEcritureVerifiee(_sb.from("devis").delete().eq("id", devisDbId).select("id"), "suppression du devis", { suite:"(il réapparaîtra au rechargement)" });
  } catch (e) { console.warn("[deleteDevisDb]", e); }
}

// ============================================================
// TICKETS EN ATTENTE — persistance DB des brouillons non-encaissés
// ============================================================

async function savePendingTkDb(pk) {
  if (!_isOnline || !_salonId || !pk) return null;
  try {
    var data = {
      salon_id: _salonId,
      local_id: pk.id || null,
      date_creation: pk.date || new Date().toISOString().slice(0,10),
      heure_creation: (pk.time && pk.time.length === 5) ? pk.time + ":00" : (pk.time || null),
      client_id: (typeof pk.cId === "string" && pk.cId.length === 36) ? pk.cId : null,
      client_nom: pk.clientName || null,
      collaborateur_id: pk.stId || null,
      collaborateur_nom: pk.styName || null,
      items: pk.items || [],
      remise: Number(pk.remise || 0),
      total: Number(pk.total || 0),
      raw_data: pk
    };
    var res = await _sb.from("tickets_attente").insert(data).select().single();
    if (res.error) { console.warn("[savePendingTkDb]", res.error); window._lxDerniereErreurEcriture = res.error.message; return null; }
    if (res.data) pk.dbId = res.data.id;
    return res.data;
  } catch (e) { console.error("[savePendingTkDb]", e); window._lxDerniereErreurEcriture = (e && e.message) || "probl\u00e8me de connexion"; return null; }
}

async function deletePendingTkDb(pkDbId) {
  if (!_isOnline || !pkDbId) return;
  try {
    return await lxEcritureVerifiee(_sb.from("tickets_attente").delete().eq("id", pkDbId).select("id"), "suppression du ticket en attente", { toast:true, suite:"(il réapparaîtra au rechargement)" });
  } catch (e) { console.warn("[deletePendingTkDb]", e); }
}

if (typeof window !== "undefined") {
  window.savePendingTkDb = savePendingTkDb;
  window.deletePendingTkDb = deletePendingTkDb;
}

// Expose les fonctions globalement pour que app.html puisse les appeler
if (typeof window !== "undefined") {
  window.saveTicketToDb = saveTicketToDb;
  window.cancelTicketDb = cancelTicketDb;
  window.lockTicketsForCloture = lockTicketsForCloture;
  window.saveDevisToDb = saveDevisToDb;
  window.updateDevisStatus = updateDevisStatus;
  window.deleteDevisDb = deleteDevisDb;
}

// Confirmer/annuler un RDV en ligne
async function updateRdvOnline(rdvId, status, reason) {
  if (!_isOnline || !_salonId) return;
  var data = { status: status };
  if (status === "confirmed") data.confirmed_at = new Date().toISOString();
  if (status === "cancelled") { data.cancelled_at = new Date().toISOString(); data.cancel_reason = reason || ""; }
  // 2026-10-15 : resultat verifie + alerte
  return await lxEcritureVerifiee(_sb.from("rdv_online").update(data).eq("id", rdvId).eq("salon_id", _salonId).select("id"), "statut du rendez-vous en ligne");
}

// Sauvegarder une clôture Z (persistance NF525 + raw_data pour réimpression fidèle)
// 2026-10-07 : relit les cloture Z depuis la base juste avant une cloture manuelle. Une Z peut avoir
// ete creee ailleurs depuis l'ouverture de l'app (cloture automatique de nuit, autre appareil) : sans
// cette relecture, l'app proposait de recloturer une journee deja close, et calculait le numero et les
// cumuls sans tenir compte de cette Z (numero en collision -> cloture du jour non enregistree).
async function _lxRafraichirClotures() {
  if (!_sb || !_salonId) return false;
  try {
    var r = await _sb.from("clotures").select("*").eq("salon_id", _salonId).order("num", { ascending: false }).limit(500);
    if (r.error || !r.data) return false;
    var fresh = r.data.slice().reverse().map(_mapClotureRow);
    var ids = {}, jours = {}; fresh.forEach(function(c){ ids[c.id] = true; if (c.date) jours[c.date] = true; });
    // FIX 2026-10-09 : on garde aussi une Z locale pas encore enregistrée (réseau coupé, file WAL),
    // même si son numéro dépasse ceux de la base -> la Z suivante ne reprend jamais le même numéro.
    // Une Z locale dont la journée existe déjà en base est écartée (la base fait foi).
    var older = (window.CLOTURES || []).filter(function(c){ return c && c.id && !ids[c.id] && !(c.date && jours[c.date]); });
    window.CLOTURES = older.concat(fresh).sort(function(a,b){ return (a.num||0) - (b.num||0); });
    if (!window.LOCKED_DAYS) window.LOCKED_DAYS = {};
    window.CLOTURES.forEach(function(c){ if (c && c.date) window.LOCKED_DAYS[c.date] = true; });
    try { await lxChargerAnnotationsZ(); } catch(_eAn) {} // 2026-10-16 : cumuls de la prochaine Z corrigés des annotations
    return true;
  } catch (e) { return false; }
}
if (typeof window !== "undefined") window._lxRafraichirClotures = _lxRafraichirClotures;
// 2026-10-16 (incident Z n°128) : annotations correctives SIGNÉES des clôtures Z (table clotures_annotations, inaltérable).
// Une Z n'est jamais modifiée : l'annotation porte les montants exacts (journal des tickets), est affichée sur la Z
// (historique, duplicata) et ses montants remplacent ceux de la Z dans les cumuls. window._lxZAnnotLues = lecture réussie
// (sinon les cumuls de la prochaine Z sont ajustés par le serveur).
async function lxChargerAnnotationsZ() {
  if (!_sb || !_salonId) return false;
  try {
    var r = await _sb.from("clotures_annotations").select("*").eq("salon_id", _salonId).order("num", { ascending: true }).limit(1000);
    if (r.error || !Array.isArray(r.data)) { window._lxZAnnotLues = false; return false; }
    window.Z_ANNOTATIONS = r.data; window._lxZAnnotLues = true; return true;
  } catch (e) { window._lxZAnnotLues = false; return false; }
}
if (typeof window !== "undefined") window.lxChargerAnnotationsZ = lxChargerAnnotationsZ;

async function saveCloture(clot) {
  if (!_isOnline || !_salonId) return { ok: false, skipped: true }; // 2026-10-14 audit : résultat explicite
  if (_lxEcrituresBloquees()) return { ok: false, skipped: true, reason: "lecture seule" }; // 2026-10-14 audit
  // WAL : persiste la clôture en LS AVANT tout traitement (filet 15/05/2026)
  var _walId = window._walBypass ? null : _walPersist("cloture", clot);
  // Raw data : tous les champs de la clôture sauf ceux qui ne sont pas sérialisables.
  // On exclut 'id' (réécrit après insert) et toute propriété non-sérialisable.
  var raw = {};
  try {
    for (var k in clot) {
      if (Object.prototype.hasOwnProperty.call(clot, k) && k !== "id") {
        var v = clot[k];
        if (typeof v !== "function" && typeof v !== "undefined") raw[k] = v;
      }
    }
  } catch(e) { console.warn("[saveCloture] raw_data build failed", e); }

  // FIX 2026-05-13 : NF525 — la clôture Z DOIT contenir la répartition par mode
  // de paiement (BOI-CF-COM-10-80-30-10 §80). Le code app.html stocke ces totaux
  // dans clot.details (cb/esp/chq/bon/vir/aut). On lit clot.perPay en priorité
  // pour rétrocompatibilité, sinon fallback sur clot.details.
  var _detailPaiements = clot.perPay || clot.details || {};
  // 2026-10-28 (-8, Luxyra 6.8.6) : montants arrondis au centime À L'ÉCRITURE (bruit de calcul flottant : 380.79999999999995,
  // 59.400000000000006, cumuls 25728.09999…). Valeur = toFixed(2), exactement celle de l'empreinte de la Z (« Z|…|CA.toFixed(2)|… ») :
  // aucune donnée ne change, seul le bruit disparaît. La base arrondit aussi (déclencheur a0_lx_clotures_arrondi).
  var _r2z = function(x){ var n = Number(x); return isFinite(n) ? Number(n.toFixed(2)) : x; };
  try { var _dp2 = {}; for (var _kd in _detailPaiements) { var _vd = _detailPaiements[_kd]; _dp2[_kd] = (typeof _vd === "number") ? _r2z(_vd) : _vd; } _detailPaiements = _dp2; } catch(_eDp) {}
  var data = {
    salon_id: _salonId,
    date_cloture: clot.date, num: clot.num,
    total_ca: _r2z(clot.totalCA), total_ht: _r2z(clot.totalHT),
    nb_tickets: clot.nbTickets, nb_annulations: clot.nbAnnul,
    detail_paiements: _detailPaiements, detail_collabs: clot.perSty || {},
    cumul_mois_ca: _r2z(clot.cumulMois || clot.cumulMoisCA || 0), cumul_mois_tickets: clot.cumulMoisTk || 0,
    cumul_annee_ca: _r2z(clot.cumulAnnuel || clot.cumulAnCA || 0), cumul_annee_tickets: clot.cumulAnTk || 0,
    hash: clot.hash, hash_algo: clot.hashAlgo || "SHA-256",
    // FIX 2026-05-28 : comptage tiroir (non fiscal, immuable une fois cloture)
    solde_reel: (typeof clot.soldeReel === "number") ? clot.soldeReel : null,
    ecart_caisse: (typeof clot.ecart === "number") ? clot.ecart : null,
    ecart_justification: clot.ecartJustification || null,
    raw_data: raw
  };
  // FIX 2026-05-12 : upsert avec id explicite — préserve la gestion d'erreur
  // 23505 sur la UNIQUE (salon_id, num) qui peut encore se déclencher en
  // multi-device si 2 clôtures essaient le même num.
  _ensureUuidId(clot);
  data.id = clot.id;
  var res = await _sb.from("clotures").upsert(data).select();
  // 2026-10-16 (incident Z n°128) : la base refuse une Z différente du journal des tickets (déclencheur
  // b_nf525_z_controle_journal). Refus définitif : jamais rejouée par la file de secours ; la journée est rouverte.
  // 2026-10-28 (-5, v6.8.3) : même traitement pour les refus « ventes encaissées non transmises » et « journée antérieure retenue »
  // 2026-10-28 (6.8.5) : LX_Z_ECART_TVA (HT déclaré ≠ somme des HT enregistrés des tickets du jour) : même traitement
  if (res.error && /LX_Z_ECART_JOURNAL|LX_Z_ECART_TVA|LX_Z_VENTES_NON_TRANSMISES|LX_Z_JOURNEE_ANTERIEURE_OUVERTE/.test(String(res.error.message || ""))) {
    console.error("[saveCloture] Z refusée : différente du journal des tickets", res.error.message);
    _walMarkSynced(_walId);
    try { if (typeof saveAuditEntry === "function") saveAuditEntry("Z_REFUSEE_ECART_JOURNAL", JSON.stringify({ cloture_num: clot.num || null, cloture_date: clot.date || null, total: clot.totalCA, nb: clot.nbTickets, msg: String(res.error.message || "").slice(0, 400) }).slice(0, 2000)); } catch (_eA) {}
    try { if (typeof window._lxZRefuseeParServeur === "function") window._lxZRefuseeParServeur(clot, res.error.message); } catch (_eR) {}
    return { ok: false, permanent: true, refuseeJournal: true, error: res.error };
  }
  if (res.error) {
    if (res.error.code === "23505" || (res.error.message || "").indexOf("clotures_unique_num_per_salon") >= 0) {
      console.warn("[saveCloture] Doublon détecté (UNIQUE constraint), clôture déjà enregistrée. Num=" + clot.num);
      try {
        var existing = await _sb.from("clotures").select("id").eq("salon_id", _salonId).eq("num", clot.num).maybeSingle();
        if (existing.data && existing.data.id) clot.id = existing.data.id;
      } catch (_e) {}
      if (typeof toast === "function") toast("⚠️ Clôture déjà enregistrée — pas de doublon créé.", "info");
      _walMarkSynced(_walId);  // déjà existante = équivalent synchronisé
      return { ok: true, deja: true }; // 2026-10-14 (NF525) : résultat explicite pour la file de secours
    }
    // FIX 2026-05-15 (soir) : code 42501 = RLS UPDATE block, normal pour clotures.
    // La table clotures est immuable par design NF525 (BOI-CF-COM-10-80-30-10) :
    // policies INSERT + SELECT uniquement, pas d'UPDATE/DELETE. Un upsert qui
    // tape sur une ligne existante (id déjà présent) déclenche ce code.
    // → On traite comme un succès : la clôture est déjà en DB et NF525-conforme.
    if (res.error.code === "42501" || (res.error.message || "").indexOf("row-level security") >= 0) {
      // 2026-10-14 audit (NF525) : 42501 est AUSSI renvoyé quand la session est perdue (insertion refusée) : avant,
      // la clôture était alors marquée « transmise » sans exister en base. On vérifie qu'elle est bien en base.
      var _zEnBase = false;
      try {
        var _zq = await _sb.from("clotures").select("id").eq("salon_id", _salonId).or("id.eq." + clot.id + ",num.eq." + Number(clot.num || 0)).limit(1);
        _zEnBase = !!(_zq && !_zq.error && _zq.data && _zq.data.length);
      } catch(_eZ) {}
      if (_zEnBase) {
        console.warn("[saveCloture] Clôture immutable (RLS UPDATE block) — déjà enregistrée. Num=" + clot.num);
        _walMarkSynced(_walId);
        return { ok: true, deja: true }; // 2026-10-14 (NF525)
      }
      try { await _lxControleSession(res.error, false); } catch(_eS) {}
      console.error("[saveCloture] refus 42501 et clôture absente en base : reste en file", clot.num);
      return { ok: false, error: res.error };
    }
    console.error("[saveCloture] Erreur upsert:", res.error);
    if (typeof toast === "function") toast("Erreur enregistrement clôture : " + res.error.message, "error");
    // FIX 2026-05-15 : log DB_ERROR pour monitoring admin
    try {
      if (typeof saveAuditEntry === "function") {
        saveAuditEntry("DB_ERROR", JSON.stringify({
          fn:"saveCloture",
          msg: res.error.message || String(res.error),
          code: res.error.code || null,
          cloture_num: clot.num || null,
          cloture_date: clot.date || null,
          cloture_ca: clot.totalCA || null
        }).slice(0,2000));
      }
    } catch(_){}
    return { ok: false, error: res.error }; // 2026-10-14 (NF525) : échec signalé à la file de secours (reste en file)
  }
  _walMarkSynced(_walId);
  return { ok: true }; // 2026-10-14 (NF525) : succès confirmé
}

// Sauvegarder une entrée d'audit
async function saveAuditEntry(action, detail) {
  if (!_isOnline || !_salonId) {
    console.warn("[AUDIT] saveAuditEntry skipped: _isOnline="+_isOnline+" _salonId="+_salonId);
    return false;
  }
  var payload = {
    salon_id: _salonId, action: action, details: detail || ""
  };
  // NF525: joindre l'opérateur connecté si disponible
  if (typeof window.CURRENT_OPERATOR !== "undefined" && window.CURRENT_OPERATOR) {
    payload.operator_id = window.CURRENT_OPERATOR.id;
    payload.operator_name = window.CURRENT_OPERATOR.prenom + (window.CURRENT_OPERATOR.nom ? " " + window.CURRENT_OPERATOR.nom : "");
  }
  try {
    var res = await _sb.from("audit_log").insert(payload);
    if (res && res.error) {
      console.error("[AUDIT] Erreur insert audit_log:", res.error.message || res.error, "payload:", payload);
      // Retry sans operator_id/operator_name au cas où les colonnes n'existeraient pas
      if (payload.operator_id) {
        var fallback = {salon_id: _salonId, action: action, details: detail || ""};
        var res2 = await _sb.from("audit_log").insert(fallback);
        if (res2 && res2.error) {
          console.error("[AUDIT] Erreur fallback insert:", res2.error.message || res2.error);
          return false;
        } else {
          console.warn("[AUDIT] Insert réussi sans operator_id (colonnes peut-être manquantes)");
          return true;
        }
      }
      return false;
    } else {
      console.log("[AUDIT] Insert OK:", action);
      return true; // 2026-10-14 : résultat renvoyé (les appelants qui l'ignorent sont inchangés)
    }
  } catch(e) {
    console.error("[AUDIT] Exception saveAuditEntry:", e.message || e);
    return false;
  }
}

// 2026-10-17 audit réglages (#72) : CODE MORT renommé. La fonction réellement exécutée est saveSalonConfig d'app.html
// (chargée après ce fichier, elle remplaçait celle-ci) ; ce nom distinct évite toute confusion. Aucun appelant.
async function _lxSaveSalonConfigAncienInutilise() {
  if (!_isOnline || !_salonId) return;
  var data = {
    nom: SALON_CONFIG.nom, sous_titre: SALON_CONFIG.sousTitre,
    logo: SALON_CONFIG.logo, adresse: SALON_CONFIG.adresse,
    cp: SALON_CONFIG.cp, ville: SALON_CONFIG.ville,
    tel: SALON_CONFIG.tel, email: SALON_CONFIG.email,
    site_web: SALON_CONFIG.siteWeb, siret: SALON_CONFIG.siret,
    tva: SALON_CONFIG.tva, couleur_primaire: SALON_CONFIG.couleurPrimaire,
    couleur_secondaire: SALON_CONFIG.couleurSecondaire,
    taux_tva: SALON_CONFIG.tauxTVA,
    metier: SALON_CONFIG.metier || "coiffure",
    metiers_autres: (Array.isArray(SALON_CONFIG.metiers) ? SALON_CONFIG.metiers : []).filter(function (m) { return m && m !== (SALON_CONFIG.metier || "coiffure"); }),
    mode_activite: SALON_CONFIG.modeActivite || "salon",
    zone_deplacement_km: SALON_CONFIG.zoneDeplacementKm || 0,
    frais_deplacement: SALON_CONFIG.fraisDeplacement || 0,
    show_tva_ticket: window.SHOW_TVA_TICKET
  };
  try{
    var _sc=window.SITE_CONFIG||{};
    var newCfg = {
      nom:SALON_CONFIG.nom,tel:SALON_CONFIG.tel,adresse:SALON_CONFIG.adresse,cp:SALON_CONFIG.cp,ville:SALON_CONFIG.ville,email:SALON_CONFIG.email,logo:SALON_CONFIG.logo,
      // Fix 2026-05-11 : on stocke le VRAI slogan (depuis site_config) et non
      // plus le sousTitre. Avant : slogan=sousTitre||slogan → "by Amandine J"
      // écrasait silencieusement "Chaque client, une création unique" dans
      // salons.config_json.slogan. Maintenant : slogan = SITE_CONFIG.slogan
      // (fallback sousTitre seulement si rien).
      slogan:_sc.slogan||SALON_CONFIG.sousTitre||"",
      sousTitre:SALON_CONFIG.sousTitre||"",
      metier:SALON_CONFIG.metier,
      siteActif:_sc.siteActif||false,reservationActive:_sc.reservationActive||false,
      photoHero:_sc.photoHero,photoSalon:_sc.photoSalon,
      slot:typeof SLOT!=="undefined"?SLOT:15,slot_h:typeof SLOT_H!=="undefined"?SLOT_H:28,
      fidconf:window.FIDCONF||{seuil:10,remise:10},
      pay_active:window.PAY_ACTIVE||{},
      fond_caisse:window.CAISSE_DATA?window.CAISSE_DATA.fond:200,
      prodcolors:window.PRODCOLORS||{},
      svccolors:typeof SVCCOLORS!=="undefined"?SVCCOLORS:{},
      sms_config:window.SMS_CONFIG||{},
      absences:window.ABSENCES||[],
      forfaits:typeof FORFAITS!=="undefined"?FORFAITS:[],
      app_bg:typeof APP_BG!=="undefined"?APP_BG:"",
      validite_devis:Number(SALON_CONFIG.validiteDevis)||30,
      // Ancien champ "categories" (liste unique) abandonné — remplacé par
      // categories_services + categories_forfaits. Ne pas le ré-écrire,
      // sinon la réparation au load le re-pousserait dans les listes
      // typées et annulerait des suppressions volontaires.
      // FIX 2026-10-07 : ecrivait [] quand la memoire n'etait pas encore peuplee,
      // effacant les familles enregistrees. On n'ecrit plus que du non vide.
      ...(function(){var o={};
        if(window.CATS_SVC&&Array.isArray(window.CATS_SVC)&&window.CATS_SVC.length) o.categories_services=window.CATS_SVC.slice();
        if(window.CATS_FORF&&Array.isArray(window.CATS_FORF)&&window.CATS_FORF.length) o.categories_forfaits=window.CATS_FORF.slice();
        return o;})(),
      // Cartes d'abonnement : modèles + toggle. CRITIQUE — sans ces 2 lignes,
      // chaque saveSalonConfig() écrasait silencieusement les modèles existants
      // en DB (cas réel rencontré sur un salon en production 2026-05-04 : les 6
      // cartes vendues continuaient de fonctionner mais le modèle source était
      // perdu, empêchant toute nouvelle vente). Garde-fou : si window.CARTES_ABO
      // est vide alors qu'il y avait des modèles en DB, on préserve les modèles
      // du cache _SALON_CONFIG_JSON pour ne pas écraser par mégarde.
      cartes_abo:(Array.isArray(window.CARTES_ABO) && window.CARTES_ABO.length > 0)
        ? window.CARTES_ABO
        : ((window._SALON_CONFIG_JSON && Array.isArray(window._SALON_CONFIG_JSON.cartes_abo))
            ? window._SALON_CONFIG_JSON.cartes_abo : []),
      cartes_abo_config:(window.CARTES_ABO_CONFIG && typeof window.CARTES_ABO_CONFIG === "object")
        ? window.CARTES_ABO_CONFIG
        : ((window._SALON_CONFIG_JSON && window._SALON_CONFIG_JSON.cartes_abo_config)
            || {active:true})
    };
    data.config_json = JSON.stringify(newCfg);
    // CRITIQUE : met à jour aussi le cache window._SALON_CONFIG_JSON
    // pour que les saves "innocents" (saveAppBg, saveSmsConfig) ne
    // ré-écrasent pas avec une version stale.
    window._SALON_CONFIG_JSON = newCfg;
  }catch(e){}
  if(!String(data.siret||"").trim()) delete data.siret; // 2026-10-13 : jamais de SIRET vide (refusé -> tout l'enregistrement échouait)
  var r=await _sb.from("salons").update(data).eq("id", _salonId);
  if(r&&r.error){delete data.config_json;await _sb.from("salons").update(data).eq("id", _salonId);}
}

// Supprime un service en DB. Vérifie le NOMBRE DE ROWS supprimées —
// car Supabase retourne 0 rows sans erreur si RLS bloque silencieusement.
async function deleteServiceDb(id) {
  if (!_sb || !_salonId || !id) return false;
  try {
    var r = await _sb.from("services").delete().eq("id", id).eq("salon_id", _salonId).select();
    if (r && r.error) { _lxReportDbError("deleteServiceDb", r.error); console.warn("[deleteServiceDb] error", r.error); return false; }
    if (!r.data || r.data.length === 0) return false;
    return true;
  } catch(e) { console.error("[deleteServiceDb]", e); return false; }
}

// Supprime un lot de services en DB. Idem : vérifie le count réel.
async function deleteServicesDbBulk(ids) {
  if (!_sb || !_salonId || !Array.isArray(ids) || !ids.length) return false;
  try {
    var r = await _sb.from("services").delete().in("id", ids).eq("salon_id", _salonId).select();
    var count = (r && r.data) ? r.data.length : 0;
    if (r && r.error) { _lxReportDbError("deleteServicesDbBulk", r.error); console.warn("[deleteServicesDbBulk] error", r.error); return false; }
    if (count === 0 && ids.length > 0) return false;
    if (count < ids.length) {
      // Partiel = on continue (au moins une partie a été nettoyée)
    }
    return true;
  } catch(e) { console.error("[deleteServicesDbBulk]", e); return false; }
}

if (typeof window !== "undefined") {
  window.deleteServiceDb = deleteServiceDb;
  window.deleteServicesDbBulk = deleteServicesDbBulk;
}

// Sauvegarder les collaborateurs
// Sauvegarder les services
// FIX 2026-10-07 : garde-fou commun aux enregistrements « en masse » (qui parcourent une liste
// en memoire et INSERENT ce qui n'existe pas en base). Si la liste n'a pas ete chargee depuis la
// base de CE salon, on n'ecrit rien : sinon on risquait d'inserer des donnees qui ne sont pas les
// siennes (valeurs par defaut, ou etat d'un autre compte).
function _lxListeChargee(table, silencieux){
  if (window._lxTableOk && window._lxTableOk[table] === true) return true;
  // 2026-10-07 : pendant le chargement (affichage anticipe depuis le cache, qui appelle go()),
  // la liste n'est pas encore chargee : c'est NORMAL. On n'ecrit pas (la sauvegarde suivante,
  // apres chargement, le fera) et on ne declenche AUCUNE alerte. Faux positif constate chez
  // Excellence Coiffure le 07/10 (2 DB_ERROR « liste collaborateurs non chargee »).
  if (window._lxChargementEnCours === true) return false;
  try{
    if (!window._lxListeAlerte) window._lxListeAlerte = {};
    if (!window._lxListeAlerte[table]) {
      window._lxListeAlerte[table] = true;
      if (typeof saveAuditEntry === "function") saveAuditEntry("DB_ERROR", JSON.stringify({fn:"save_"+table, msg:"liste "+table+" non chargee depuis la base - enregistrement bloque"}));
    }
    if (!silencieux && typeof toast === "function") toast("\u26a0 Donnees non chargees - rechargez l'application avant de modifier", "error");
  }catch(_e){}
  return false;
}
// 2026-10-14 : catalogue enregistre LIGNE PAR LIGNE. On n'ecrit que les lignes qui ont
// change depuis le chargement / le dernier enregistrement reussi (signature), ou marquees
// _dirty / _new. Un appareil reste ouvert longtemps ne reecrit donc plus tout le catalogue
// par-dessus les modifications faites ailleurs. Chaque resultat est verifie.
window._lxSvcSig = window._lxSvcSig || {};
window._lxForfSig = window._lxForfSig || {};
// 2026-10-15 : colonnes « prix à partir de » / « sur devis » des forfaits : écrites seulement si elles existent en base
// (vu au chargement) ou si l'option est cochée -> sans le SQL apartir.sql, rien ne change pour les fiches existantes.
window._lxColsCat = window._lxColsCat || {};
function _lxSvcPayload(s) {
  var o = {
    salon_id: _salonId, nom: s.n, prix: s.p,
    categorie: s.cat, phases: s.phases || [],
    // FIX 2026-05-13 : cat_genre = tag H/F/E pour les stats genre précises au niveau item
    cat_genre: (s.catGenre === 'H' || s.catGenre === 'F' || s.catGenre === 'E') ? s.catGenre : null,
    show_site: s.showSite !== false, book_online: s.bookOnline !== false,
    prix_sur_devis: s.devis === true // 2026-10-13 : prestation sur devis (prix saisi à l'encaissement)
  };
  if (window._lxColsCat.svcApd || s.apartir === true) o.prix_a_partir_de = (s.apartir === true && s.devis !== true); // 2026-10-15 : prix minimum
  return o;
}
function _lxForfPayload(f) {
  var o = {
    salon_id: _salonId, nom: f.n, prix: f.p,
    categorie: f.cat, services: f.services || [],
    phases: f.phases || [],
    // FIX 2026-05-13 : cat_genre pour stats (H/F/E) — utile aux forfaits enfant (ado, junior)
    cat_genre: (f.catGenre === 'H' || f.catGenre === 'F' || f.catGenre === 'E') ? f.catGenre : null,
    show_site: f.showSite !== false, book_online: f.bookOnline !== false
  };
  if (window._lxColsCat.forfDevis || f.devis === true) o.prix_sur_devis = (f.devis === true); // 2026-10-15
  if (window._lxColsCat.forfApd || f.apartir === true) o.prix_a_partir_de = (f.apartir === true && f.devis !== true);
  return o;
}
function _lxSig(o) { try { return JSON.stringify(o); } catch(_e) { return ""; } }
// Appele par le chargement : memorise l'etat « en base » de chaque ligne
function _lxCatSigReset(kind, list) {
  var m = {};
  (list || []).forEach(function(r){ if (r && r.id != null) m[r.id] = _lxSig(kind === "forfaits" ? _lxForfPayload(r) : _lxSvcPayload(r)); });
  if (kind === "forfaits") window._lxForfSig = m; else window._lxSvcSig = m;
}
window._lxCatSigReset = _lxCatSigReset;
var _lxCatQueue = Promise.resolve();
function _lxCatEnFile(fn) {
  var p = _lxCatQueue.then(fn, fn);
  _lxCatQueue = p.then(function(){}, function(){});
  return p;
}
// Ecrit UNE ligne : update par id (resultat verifie) ; insert seulement pour une ligne
// nouvelle (jamais vue en base sur cet appareil). Jamais d'insert apres une erreur.
// 2026-10-15 MULTI-APPAREILS :
//  - seuls les CHAMPS modifies ici depuis la lecture / le dernier enregistrement sont envoyes (la signature
//    sigMap[id] sert de reference) : un autre appareil qui a change le prix garde son prix si l'on change ici
//    la categorie ;
//  - ligne deja vue en base mais introuvable (supprimee sur un autre appareil) : elle n'est PLUS recreee
//    (avant : re-insertion silencieuse sous un nouvel id) -> {supprime:true}, message + liste mise a jour.
async function _lxSaveCatRow(table, row, payload, sigMap) {
  try {
    var hasId = (typeof row.id === "number" && row.id > 0);
    var connu = hasId && row._new !== true && Object.prototype.hasOwnProperty.call(sigMap, row.id);
    if (hasId && row._new !== true) {
      var envoi = payload, base = null;
      if (connu) { try { base = JSON.parse(sigMap[row.id]); } catch(_eB) { base = null; } }
      if (base && typeof base === "object") {
        envoi = {};
        Object.keys(payload).forEach(function(k){ if (k !== "salon_id" && _lxSig(payload[k]) !== _lxSig(base[k])) envoi[k] = payload[k]; });
        if (!Object.keys(envoi).length) { sigMap[row.id] = _lxSig(payload); delete row._dirty; return { ok:true }; }
      }
      var u = await _sb.from(table).update(envoi).eq("id", row.id).eq("salon_id", _salonId).select("id");
      if (u.error) return { ok:false, error:u.error.message };
      if (u.data && u.data.length) { sigMap[row.id] = _lxSig(payload); delete row._dirty; return { ok:true }; }
      if (connu) {
        var ex = await _sb.from(table).select("id").eq("id", row.id).eq("salon_id", _salonId).limit(1);
        if (ex && !ex.error && ex.data && ex.data.length) return { ok:false, error:"aucune modification acceptée par le serveur" };
        if (ex && ex.error) return { ok:false, error:ex.error.message };
        return { ok:false, supprime:true, error:"supprimée sur un autre appareil" };
      }
    }
    var ins = await _sb.from(table).insert(payload).select("id");
    if (ins.error) return { ok:false, error:ins.error.message };
    if (!ins.data || !ins.data[0]) return { ok:false, error:"aucune ligne créée" };
    row.id = ins.data[0].id;
    delete row._new; delete row._dirty;
    sigMap[row.id] = _lxSig(payload);
    return { ok:true, created:true };
  } catch (e) { return { ok:false, error:(e && e.message) || "erreur réseau" }; }
}
// 2026-10-15 : lignes supprimees sur un autre appareil -> retirees de la memoire de CET appareil + message
function _lxCatRetirerSupprimes(list, sigMap, supprimes, quoi) {
  if (!supprimes.length) return;
  var ids = {}; supprimes.forEach(function(r){ ids[String(r.id)] = 1; delete sigMap[r.id]; });
  try { if (Array.isArray(list)) { for (var i = list.length - 1; i >= 0; i--) { if (list[i] && ids[String(list[i].id)]) list.splice(i, 1); } } } catch(_e) {}
  try {
    var noms = supprimes.map(function(r){ return "« " + (r.n || "?") + " »"; }).slice(0, 5).join(", ");
    var m = "⚠️ " + noms + (supprimes.length > 1 ? " ont" : " a") + " été supprimé" + (supprimes.length > 1 ? "s" : "") + " sur un autre appareil : " + (supprimes.length > 1 ? "ces " + quoi + " n'ont" : "la modification n'a") + " pas été enregistrée" + (supprimes.length > 1 ? "s" : "") + " (rien n'a été recréé). La liste a été mise à jour.";
    if (typeof showAlert === "function") showAlert(m, "warning"); else if (typeof toast === "function") toast(m, "warning");
    if (typeof saveAuditEntry === "function") saveAuditEntry("CONFLIT_SYNCHRO", JSON.stringify({ quoi: quoi, supprimes_ailleurs: supprimes.map(function(r){ return { id: r.id, n: r.n }; }) }).slice(0, 2000));
    if (typeof refreshCurrentView === "function") refreshCurrentView();
    if (window._currentPage === "services" && typeof go === "function") go("services");
  } catch(_e) {}
}
function _lxCatAlerte(quoi, errs) {
  console.error("[save " + quoi + "]", errs);
  try {
    var m = "⚠️ " + errs.length + " " + quoi + " non enregistrée(s) :\n" + errs.slice(0, 5).join("\n") + (errs.length > 5 ? "\n…" : "") + "\n\nRéessayez. Si le problème continue, rechargez l'application.";
    if (typeof showAlert === "function") showAlert(m, "warning"); else if (typeof toast === "function") toast(m, "error");
  } catch(_e) {}
}
async function _lxSaveCatList(table, list, payloadFn, sigMap, quoi) {
  if (!_sb || !_salonId) return { ok:false, error:"hors ligne" };
  if (!_lxListeChargee(table)) return { ok:false, error:"liste non chargée" };
  var errs = [], nb = 0, supprimes = [];
  var rows = (list || []).slice();
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i]; if (!r) continue;
    var payload = payloadFn(r);
    if (r._new !== true && r._dirty !== true && r.id != null && sigMap[r.id] === _lxSig(payload)) continue; // inchangee
    nb++;
    var res = await _lxSaveCatRow(table, r, payload, sigMap);
    if (res.supprime) { supprimes.push(r); continue; }
    if (!res.ok) errs.push((r.n || "?") + " : " + res.error);
  }
  _lxCatRetirerSupprimes(list, sigMap, supprimes, quoi);
  if (errs.length) { _lxCatAlerte(quoi, errs); return { ok:false, error:errs.join(" ; "), count:nb }; }
  if (supprimes.length) return { ok:false, supprime:true, error:"supprimée(s) sur un autre appareil", count:nb };
  return { ok:true, count:nb };
}
// Enregistre les prestations modifiees (wrapper historique : appele apres chaque edition)
function saveServices() {
  return _lxCatEnFile(function(){ return _lxSaveCatList("services", (typeof SVC !== "undefined") ? SVC : [], _lxSvcPayload, window._lxSvcSig, "prestation(s)"); });
}
// Enregistre UNE prestation
function saveService(s) {
  return _lxCatEnFile(async function(){
    if (!_sb || !_salonId || !s) return { ok:false, error:"hors ligne" };
    if (!_lxListeChargee("services")) return { ok:false, error:"liste non charg\u00e9e" };
    var r = await _lxSaveCatRow("services", s, _lxSvcPayload(s), window._lxSvcSig);
    if (r.supprime) _lxCatRetirerSupprimes((typeof SVC !== "undefined") ? SVC : null, window._lxSvcSig, [s], "prestations");
    else if (!r.ok) _lxCatAlerte("prestation(s)", [(s.n || "?") + " : " + r.error]);
    return r;
  });
}

// Sauvegarder les forfaits
function saveForfaits() {
  return _lxCatEnFile(async function(){
    var r = await _lxSaveCatList("forfaits", (typeof FORFAITS !== "undefined") ? FORFAITS : [], _lxForfPayload, window._lxForfSig, "forfait(s)");
    // Also save to localStorage as backup
    try { localStorage.setItem("_cp_forfaits", JSON.stringify(FORFAITS)); } catch(e) {}
    return r;
  });
}
function saveForfait(f) {
  return _lxCatEnFile(async function(){
    if (!_sb || !_salonId || !f) return { ok:false, error:"hors ligne" };
    if (!_lxListeChargee("forfaits")) return { ok:false, error:"liste non charg\u00e9e" };
    var r = await _lxSaveCatRow("forfaits", f, _lxForfPayload(f), window._lxForfSig);
    if (r.supprime) _lxCatRetirerSupprimes((typeof FORFAITS !== "undefined") ? FORFAITS : null, window._lxForfSig, [f], "forfaits");
    else if (!r.ok) _lxCatAlerte("forfait(s)", [(f.n || "?") + " : " + r.error]);
    try { localStorage.setItem("_cp_forfaits", JSON.stringify(FORFAITS)); } catch(e) {}
    return r;
  });
}
if (typeof window !== "undefined") { window.saveService = saveService; window.saveForfait = saveForfait; }

// Sauvegarder un pack client (achat ou validation séance)
async function savePack(pack) {
  if (!_sb || !_salonId) return;
  var data = {
    salon_id: _salonId,
    client_id: pack.clientId || "",
    client_nom: pack.clientNom || "",
    nom: pack.nom,
    prestation_id: pack.prestId || null,
    prestation_nom: pack.prestNom || "",
    total_seances: pack.total,
    seances_utilisees: pack.used || 0,
    prix_total: pack.prix,
    date_achat: pack.dateAchat,
    date_expiration: pack.dateExp || null,
    ticket_num: pack.ticketNum || "",
    status: pack.status || "active"
  };
  // FIX 2026-05-12 : upsert avec id explicite (U() génère UUID stable)
  _ensureUuidId(pack);
  data.id = pack.id;
  var res = await _sb.from("packs_clients").upsert(data).select();
  // 2026-10-14 : erreur affichee a l'utilisateur
  if (res.error) {
    console.error("savePack upsert error:", res.error);
    try { if (typeof showAlert === "function") showAlert("\u26a0\ufe0f Forfait client \u00ab " + (pack.nom || "") + " \u00bb non enregistr\u00e9 : " + (res.error.message || "erreur") + ". V\u00e9rifiez avant de fermer l'application.", "warning"); } catch(_e) {}
    return { ok:false, error:res.error.message };
  }
  return { ok:true };
}

// Valider une séance d'un pack
async function usePackSeance(packId) {
  if (!_sb) return;
  var pk = (window.PACKS_CLIENTS || []).find(function(p) { return p.id === packId; });
  if (!pk) return;
  var _prevUsed = pk.used || 0, _prevStatus = pk.status;
  pk.used = (pk.used || 0) + 1;
  if (pk.used >= pk.total) pk.status = "completed";
  // 2026-10-14 : resultat verifie ; en cas d'echec la memoire est remise comme avant + alerte
  var _r = null;
  try { _r = await _sb.from("packs_clients").update({ seances_utilisees: pk.used, status: pk.status }).eq("id", packId).eq("salon_id", _salonId).select("id"); } catch(e) { _r = { error: e }; }
  if (!_r || _r.error || !_r.data || !_r.data.length) {
    pk.used = _prevUsed; pk.status = _prevStatus;
    var _em = (_r && _r.error && _r.error.message) || "aucune ligne modifi\u00e9e";
    console.error("[usePackSeance]", _em);
    try { if (typeof showAlert === "function") showAlert("\u26a0\ufe0f La s\u00e9ance n'a pas pu \u00eatre d\u00e9compt\u00e9e du forfait : " + _em + ". R\u00e9essayez.", "warning"); } catch(_e) {}
    return null;
  }
  return pk;
}

// Supprimer un forfait
async function deleteForfaitFromDb(forfaitId) {
  if (!_sb || !_salonId) return;
  // 2026-10-15 : resultat verifie (avant : refus muet -> le forfait revenait au rechargement)
  return await lxEcritureVerifiee(_sb.from("forfaits").delete().eq("id", forfaitId).eq("salon_id", _salonId).select("id"), "suppression du forfait", { suite:"(il réapparaîtra au rechargement)" });
}

// 2026-10-14 : file d'attente commune a TOUTES les ecritures collaborateurs (bulk + ciblees) :
// deux enregistrements ne se chevauchent plus (lecture puis ecriture faites l'une apres l'autre).
var _lxCollabQueue = Promise.resolve();
function _lxCollabEnFile(fn) {
  var p = _lxCollabQueue.then(fn, fn);
  _lxCollabQueue = p.then(function(){}, function(){});
  return p;
}
function _lxCollabAlerte(msg) {
  try { if (typeof showAlert === "function") showAlert(msg, "warning"); else if (typeof toast === "function") toast(msg, "error"); } catch(_e) {}
}
// 2026-10-14 : enregistrement en masse, serialise, chaque resultat verifie. Utilise
// uniquement pour une creation (plus appele a chaque changement de page).
function saveCollaborateurs() { return _lxCollabEnFile(_saveCollaborateursUneFois); }
async function _saveCollaborateursUneFois() {
  if (!_isOnline || !_salonId) return { ok:false, error:"hors ligne" };
  // appelee a chaque changement de page : blocage silencieux (une seule alerte monitoring)
  if (!_lxListeChargee("collaborateurs", true)) return { ok:false, error:"liste non chargee" };
  // FIX 2026-05-11 (Manue photo perdue) : récupère img+id pour pouvoir
  // PRÉSERVER une photo DB existante si la mémoire locale a img="" (race
  // condition entre 2 sessions / reload partiel). La suppression explicite
  // passe par clearStyImg → clearCollabPhoto(id) qui force img="" directement.
  // FIX : on récupère AUSSI horaires_overrides pour ne jamais écraser en base des
  // dates personnalisées absentes de la mémoire locale (état périmé/cache) —
  // cause de "le planning redevient comme avant" (overrides du 24/25/28-07 effacés).
  var existing = await _sb.from("collaborateurs").select("id,img,nom,initiales,couleur,horaires_overrides").eq("salon_id", _salonId);
  var dbIds = {};
  var dbImg = {};
  var dbOver = {};
  // FIX 2026-06-19 : signature nom|initiales|couleur -> id existant. Permet d'ADOPTER
  // une ligne déjà en base au lieu d'INSÉRER un clone quand l'id en mémoire ne matche
  // pas (état transitoire au démarrage : T hydraté depuis le cache avant le load DB,
  // puis save déclenché par une navigation). Évite la duplication des collaborateurs.
  var dbBySig = {};
  // 2026-10-14 : lecture en echec -> on n'ecrit RIEN (sinon chaque fiche serait inseree en double)
  if (!existing || existing.error || !existing.data) {
    var _eMsg = (existing && existing.error && existing.error.message) || "lecture impossible";
    console.error("[saveCollaborateurs] lecture", _eMsg);
    _lxCollabAlerte("\u26a0\ufe0f L'\u00e9quipe n'a pas pu \u00eatre enregistr\u00e9e (" + _eMsg + "). V\u00e9rifiez la connexion et r\u00e9essayez.");
    return { ok:false, error:_eMsg };
  }
  var _errs = [], _suppr = [];
  if (existing.data) {
    for (var e = 0; e < existing.data.length; e++) {
      var ex = existing.data[e];
      dbIds[ex.id] = true;
      dbImg[ex.id] = ex.img || "";
      dbOver[ex.id] = ex.horaires_overrides || {};
      var sig = (ex.nom||"")+"|"+(ex.initiales||"")+"|"+(ex.couleur||"");
      if (dbBySig[sig] === undefined) dbBySig[sig] = ex.id;
    }
  }
  // Now save each collab
  for (var i = 0; i < T.length; i++) {
    var c = T[i];
    // DÉFENSE : si la mémoire locale a img="" mais la DB a une photo, on garde la DB.
    // Sinon (mémoire a une img OU DB vide aussi), on écrit la mémoire.
    var memImg = c.img || "";
    var preservedImg = (memImg === "" && c.id && dbImg[c.id]) ? dbImg[c.id] : memImg;
    if (preservedImg && memImg === "") {
      // On a remis la photo DB en mémoire : synchronise le tableau local
      c.img = preservedImg;
    }
    var data = {
      salon_id: _salonId, nom: c.n, initiales: c.i,
      couleur: c.c, img: preservedImg, horaires: c.hrs || {},
      pause: c.pause || null,
      // FIX 2026-05-12 : préserver horaires_overrides aussi dans le bulk save
      // FIX : FUSION DB + mémoire (au lieu d'écraser). Une sauvegarde partie d'un état
      // local périmé ne peut plus effacer des dates personnalisées enregistrées en base.
      // La mémoire reste prioritaire pour les dates qu'elle connaît (modif volontaire).
      horaires_overrides: (function(){
        var _mem = c.hrsOver || {};
        var _db  = (c.id && dbOver[c.id]) ? dbOver[c.id] : {};
        var _merged = {};
        try{
          Object.keys(_db).forEach(function(k){ _merged[k] = _db[k]; });
          Object.keys(_mem).forEach(function(k){ _merged[k] = _mem[k]; });
        }catch(_e){ _merged = _mem; }
        return _merged;
      })(),
      date_entree: c.dateEntree || null,
      date_depart: c.dateDepart || null,
      inactif: c.inactif === true,
      photo_visible: c.photoVisible !== false,
      competences: c.competences || {all:true}
    };
    // 2026-10-15 MULTI-APPAREILS : fiche deja vue en base sur cet appareil mais disparue -> supprimee sur un
    // autre appareil : on ne la recree PAS (avant : re-insertion silencieuse).
    if (c.id && !dbIds[c.id] && window._lxCollabIdsServeur && window._lxCollabIdsServeur[c.id]) { _suppr.push(c); continue; }
    // 2026-10-15 : une fiche existante n'est plus reecrite en entier depuis la memoire par l'enregistrement en
    // masse (il ecrasait les modifications faites sur un autre appareil) : chaque modification passe par
    // saveCollabPartial / saveCollabRH (champs modifies seulement). Exception : fiche marquee _dirty.
    if (c.id && dbIds[c.id] && c._dirty !== true) continue;
    if (c.id && dbIds[c.id]) {
      // FIX 2026-08-31 : la sauvegarde en masse n'ecrit PLUS le statut RH d'une fiche
      // existante. Elle l'ecrivait depuis la memoire de l'appareil : un appareil dont
      // l'application datait d'avant un archivage reactivait le collaborateur a son
      // insu (Manue, reapparue active le 31/08). Le statut RH ne se modifie desormais
      // que par le chemin dedie (saveCollabRH), qui exprime une intention explicite.
      var dataUpd = {};
      Object.keys(data).forEach(function(k){
        if (k === "inactif" || k === "date_depart" || k === "date_entree") return;
        dataUpd[k] = data[k];
      });
      var _ru = await _sb.from("collaborateurs").update(dataUpd).eq("id", c.id).eq("salon_id", _salonId).select("id");
      if (_ru.error || !_ru.data || !_ru.data.length) _errs.push((c.n||"?") + " : " + ((_ru.error && _ru.error.message) || "non modifi\u00e9"));
      else delete c._dirty;
    } else {
      // FIX 2026-06-19 : avant d'insérer, on cherche un collaborateur identique déjà
      // en base (même nom + initiales + couleur). S'il existe, on l'ADOPTE (UPDATE +
      // récupération de son id) au lieu de créer un doublon. Sinon -> vrai nouveau -> INSERT.
      var _sig = (c.n||"")+"|"+(c.i||"")+"|"+(c.c||"");
      if (dbBySig[_sig] !== undefined) {
        c.id = dbBySig[_sig];
        var _ra = await _sb.from("collaborateurs").update(data).eq("id", c.id).eq("salon_id", _salonId).select("id");
        if (_ra.error || !_ra.data || !_ra.data.length) _errs.push((c.n||"?") + " : " + ((_ra.error && _ra.error.message) || "non modifi\u00e9"));
      } else {
        var res = await _sb.from("collaborateurs").insert(data).select();
        if (res.error || !res.data || !res.data[0]) _errs.push((c.n||"?") + " : " + ((res.error && res.error.message) || "non cr\u00e9\u00e9"));
        else { c.id = res.data[0].id; dbIds[c.id] = true; dbBySig[_sig] = c.id; try { if (window._lxCollabIdsServeur) window._lxCollabIdsServeur[c.id] = 1; } catch(_eI) {} }
      }
    }
  }
  if (_suppr.length) _lxCollabSupprimeAilleurs(_suppr.map(function(c){ return c.n; }));
  if (_errs.length) {
    console.error("[saveCollaborateurs]", _errs);
    _lxCollabAlerte("\u26a0\ufe0f Certaines fiches de l'\u00e9quipe n'ont pas \u00e9t\u00e9 enregistr\u00e9es :\n" + _errs.slice(0, 5).join("\n") + "\n\nR\u00e9essayez.");
    return { ok:false, error:_errs.join(" ; ") };
  }
  return { ok:true };
}

// 2026-10-15 MULTI-APPAREILS : 0 ligne modifiee -> la fiche existe-t-elle encore ? Sinon elle a ete supprimee
// sur un autre appareil : message clair + liste rechargee (jamais recreee).
async function _lxCollabZeroLigne(cid) {
  try {
    var ex = await _sb.from("collaborateurs").select("id").eq("id", cid).eq("salon_id", _salonId).limit(1);
    if (ex && !ex.error && ex.data && !ex.data.length) { _lxCollabSupprimeAilleurs(null); return { ok:false, supprime:true, error:"fiche supprim\u00e9e sur un autre appareil" }; }
  } catch(_e) {}
  return { ok:false, error:"aucune fiche modifi\u00e9e (droits ?)" };
}
function _lxCollabSupprimeAilleurs(noms) {
  try {
    var m = "\u26a0\ufe0f " + (noms && noms.length ? noms.map(function(n){ return "\u00ab " + (n || "?") + " \u00bb"; }).join(", ") : "Cette fiche") + " : supprim\u00e9" + ((noms && noms.length > 1) ? "es" : "e") + " sur un autre appareil. La modification n'a pas \u00e9t\u00e9 enregistr\u00e9e (rien n'a \u00e9t\u00e9 recr\u00e9\u00e9) ; l'\u00e9quipe a \u00e9t\u00e9 recharg\u00e9e.";
    _lxCollabAlerte(m);
    if (typeof reloadFromSupabase === "function") reloadFromSupabase("collaborateurs");
  } catch(_e) {}
}
// Modification VOLONTAIRE du statut RH d'un collaborateur (depart / inactif).
// Renseigne rh_updated_at : c'est ce champ qui signale a la base une intention
// explicite. Sans lui, la protection en base refuse toute reactivation, ce qui
// empeche un appareil non recharge d'annuler un archivage.
async function saveCollabRH(collabId, fields) {
  if (!_isOnline || !_salonId || !collabId) return { ok:false, error:"hors ligne" };
  var payload = {};
  if (Object.prototype.hasOwnProperty.call(fields||{}, "inactif"))     payload.inactif = fields.inactif === true;
  if (Object.prototype.hasOwnProperty.call(fields||{}, "dateDepart"))  payload.date_depart = fields.dateDepart || null;
  if (Object.prototype.hasOwnProperty.call(fields||{}, "dateEntree"))  payload.date_entree = fields.dateEntree || null;
  if (!Object.keys(payload).length) return { ok:true };
  payload.rh_updated_at = new Date().toISOString();
  try {
    var r = await _sb.from("collaborateurs").update(payload).eq("id", collabId).eq("salon_id", _salonId).select("id,inactif,date_depart");
    if (r && r.error) { console.error("[saveCollabRH]", r.error); return { ok:false, error:r.error.message }; }
    // 2026-10-14 : 0 ligne modifiee (droits) = echec ; 2026-10-15 : ou fiche supprimee ailleurs
    if (!r || !r.data || !r.data.length) return await _lxCollabZeroLigne(collabId);
    return { ok:true, data:(r && r.data && r.data[0]) || null };
  } catch (e) {
    console.error("[saveCollabRH]", e);
    return { ok:false, error:(e && e.message) || "erreur" };
  }
}
window.saveCollabRH = saveCollabRH;

// Effacement explicite de la photo d'un collaborateur (utilisé par clearStyImg)
// Bypass la protection anti-écrasement de saveCollaborateurs().
async function clearCollabPhoto(collabId) {
  // 2026-10-14 : resultat verifie ({ok,error}) ; 0 ligne modifiee = echec
  if (!_isOnline || !_salonId || !collabId) return { ok:false, error:"hors ligne" };
  return _lxCollabEnFile(async function(){
    try {
      var r = await _sb.from("collaborateurs").update({ img: "" }).eq("id", collabId).eq("salon_id", _salonId).select("id");
      if (r.error) return { ok:false, error:r.error.message };
      if (!r.data || !r.data.length) return await _lxCollabZeroLigne(collabId);
      return { ok:true };
    } catch (e) { return { ok:false, error:(e && e.message) || "erreur r\u00e9seau" }; }
  });
}

// FIX 2026-05-12 : update CIBLÉ d'un seul collab pour éviter le pattern
// "le bulk save de saveCollaborateurs écrase les autres collabs avec
// la mémoire locale stale". Quand l'utilisateur modifie un horaire/pause
// d'un seul collab, on ne touche QUE ce collab en DB.
// 2026-10-14 : retourne {ok,error}. Resultat verifie (.select("id") + nb de lignes).
// horaires_overrides : FUSION avec la base (base d'abord, puis les dates modifiees).
// opts.dates = liste des dates modifiees ; une date absente de la memoire = suppression
// explicite (ne ressuscite pas un personnalise efface). Sans opts.dates : base + memoire.
async function saveCollabPartial(collabIdx, fields, opts) {
  if (!_isOnline || !_salonId) return { ok:false, error:"pas de connexion au serveur" };
  if (typeof collabIdx !== "number" || !T[collabIdx]) return { ok:false, error:"collaborateur introuvable" };
  var c = T[collabIdx];
  if (!c.id || typeof fields !== "object" || !fields) return { ok:false, error:"fiche non encore enregistr\u00e9e" };
  var cid = c.id;
  return _lxCollabEnFile(async function(){
    try {
      var payload = {};
      Object.keys(fields).forEach(function(k){ payload[k] = fields[k]; });
      if (Object.prototype.hasOwnProperty.call(payload, "horaires_overrides")) {
        var cur = await _sb.from("collaborateurs").select("horaires_overrides").eq("id", cid).eq("salon_id", _salonId);
        if (cur.error) return { ok:false, error:cur.error.message };
        if (!cur.data || !cur.data.length) { _lxCollabSupprimeAilleurs([c.n]); return { ok:false, supprime:true, error:"fiche supprim\u00e9e sur un autre appareil" }; }
        var dbOv = cur.data[0].horaires_overrides || {};
        var memOv = payload.horaires_overrides || {};
        var merged = {};
        Object.keys(dbOv).forEach(function(k){ merged[k] = dbOv[k]; });
        var dates = (opts && Array.isArray(opts.dates)) ? opts.dates : Object.keys(memOv);
        dates.forEach(function(k){
          if (Object.prototype.hasOwnProperty.call(memOv, k)) merged[k] = memOv[k];
          else delete merged[k];
        });
        payload.horaires_overrides = merged;
      }
      var r = await _sb.from("collaborateurs").update(payload).eq("id", cid).eq("salon_id", _salonId).select("id");
      if (r.error) { console.error("[saveCollabPartial]", r.error); return { ok:false, error:r.error.message }; }
      if (!r.data || !r.data.length) return await _lxCollabZeroLigne(cid);
      // memoire alignee sur ce qui est en base (dates des autres appareils incluses)
      if (payload.horaires_overrides && T[collabIdx] && String(T[collabIdx].id) === String(cid)) {
        if (!T[collabIdx].hrsOver) T[collabIdx].hrsOver = {};
        var _mo = T[collabIdx].hrsOver;
        Object.keys(payload.horaires_overrides).forEach(function(k){ if (!Object.prototype.hasOwnProperty.call(_mo, k)) _mo[k] = payload.horaires_overrides[k]; });
      }
      return { ok:true };
    } catch (e) { console.warn("saveCollabPartial:", e); return { ok:false, error:(e && e.message) || "erreur r\u00e9seau" }; }
  });
}
window.saveCollabPartial = saveCollabPartial;

// Supprimer un client
// 2026-10-14 : retourne {ok,error} ; 0 ligne supprimee (droits refuses) = echec
async function _lxDeleteVerifie(table, col, val) {
  if (!_isOnline || !_salonId) return { ok:false, error:"pas de connexion au serveur" };
  try {
    var q = _sb.from(table).delete().eq(col, val);
    if (col !== "salon_id") q = q.eq("salon_id", _salonId);
    var r = await q.select("id");
    if (r.error) { console.error("[delete " + table + "]", r.error); return { ok:false, error:r.error.message }; }
    if (!r.data || !r.data.length) return { ok:false, error:"rien n'a \u00e9t\u00e9 supprim\u00e9 (droits ou d\u00e9j\u00e0 supprim\u00e9)", count:0 };
    return { ok:true, count:r.data.length };
  } catch (e) { return { ok:false, error:(e && e.message) || "erreur r\u00e9seau" }; }
}
async function deleteClient(clientId) {
  return _lxDeleteVerifie("clients", "id", clientId);
}

// Supprimer un produit
async function deleteProduct(productId) {
  return _lxDeleteVerifie("produits", "id", productId);
}

// Supprimer un bon cadeau
async function deleteGiftCard(gcId) {
  // 2026-10-14 : retire de la memoire SEULEMENT apres suppression confirmee
  var r = await _lxDeleteVerifie("cartes_cadeaux", "id", gcId);
  if (r.ok) { for (var i = 0; i < GC.length; i++) { if (GC[i].id === gcId) { GC.splice(i, 1); break; } } }
  return r;
}

// Purger TOUS les bons cadeaux du salon
async function purgeAllGiftCards() {
  // 2026-10-14 : on ne vide la memoire qu'apres confirmation (0 bon en base = deja vide, ok)
  if (!_isOnline || !_salonId) return { ok:false, error:"pas de connexion au serveur" };
  try {
    var r = await _sb.from("cartes_cadeaux").delete().eq("salon_id", _salonId).select("id");
    if (r.error) { console.error("[purgeAllGiftCards]", r.error); return { ok:false, error:r.error.message }; }
    var n = (r.data || []).length;
    if (n === 0 && GC.length > 0) return { ok:false, error:"rien n'a \u00e9t\u00e9 supprim\u00e9 (droits ?)", count:0 };
    GC.length = 0;
    return { ok:true, count:n };
  } catch (e) { return { ok:false, error:(e && e.message) || "erreur r\u00e9seau" }; }
}


// ============================================================
// FOURNISSEURS CRUD
// ============================================================
async function saveFournisseur(f) {
  if (!_isOnline || !_salonId) return;
  var data = { salon_id: _salonId, nom: f.nom, email: f.email || "", telephone: f.tel || "",
               representant: f.representant || "", delai_livraison: f.delai || 7, notes: f.notes || "" };
  // FIX 2026-05-12 : upsert avec id explicite (U() génère UUID stable)
  _ensureUuidId(f);
  data.id = f.id;
  var res = await _sb.from("fournisseurs").upsert(data).select();
  // 2026-10-14 : erreur affichee a l'utilisateur (plus seulement dans la console)
  if (res.error) {
    console.error("saveFournisseur upsert error:", res.error);
    try { if (typeof showAlert === "function") showAlert("\u26a0\ufe0f Fournisseur \u00ab " + (f.nom || "") + " \u00bb non enregistr\u00e9 : " + (res.error.message || "erreur") + ". R\u00e9essayez.", "warning"); } catch(_e) {}
    return { ok:false, error:res.error.message };
  }
  return { ok:true };
}
async function deleteFournisseur(fId) {
  if (!_isOnline || !_salonId) return;
  // Unlink products first
  // 2026-10-15 : resultats verifies + alerte (avant : echec muet)
  var _rU = await lxEcritureVerifiee(_sb.from("produits").update({ fournisseur_id: null }).eq("fournisseur_id", fId).eq("salon_id", _salonId), "détachement des produits du fournisseur", { lignes:false });
  if (!_rU.ok) return _rU;
  return await lxEcritureVerifiee(_sb.from("fournisseurs").delete().eq("id", fId).eq("salon_id", _salonId).select("id"), "suppression du fournisseur", { suite:"(il réapparaîtra au rechargement)" });
}

// ============================================================
// MOUVEMENTS STOCK
// ============================================================
async function logMouvementStock(prodId, prodNom, type, qty, stkAvant, stkApres, ref, note, motif, motifLabel) {
  if (!_isOnline || !_salonId) return;
  try {
    var _opId = null, _opName = null;
    if (typeof window !== "undefined" && window.CURRENT_OPERATOR) {
      _opId = window.CURRENT_OPERATOR.id;
      _opName = window.CURRENT_OPERATOR.prenom + (window.CURRENT_OPERATOR.nom ? " " + window.CURRENT_OPERATOR.nom : "");
    }
    // 2026-10-14 : resultat verifie (Supabase ne leve pas d'exception)
    var _rM = await _sb.from("mouvements_stock").insert({
      salon_id: _salonId, produit_id: prodId, produit_nom: prodNom,
      type: type, quantite: qty, stock_avant: stkAvant, stock_apres: stkApres,
      reference: ref || null, note: note || null,
      motif: motif || null, motif_label: motifLabel || null,
      commentaire: note || null,
      operator_id: _opId, operator_name: _opName
    });
    if (_rM && _rM.error) throw _rM.error;
    return { ok:true };
  } catch(e) {
    console.error("[MVT STOCK]", e && e.message);
    // 2026-10-14 : l'utilisateur est prevenu (alerte une fois, puis message court)
    try {
      var _m = "\u26a0\ufe0f Mouvement de stock non enregistr\u00e9 dans l'historique (" + (prodNom || "") + ") : " + ((e && e.message) || "erreur");
      if (!window._lxMvtAlerte && typeof showAlert === "function") { window._lxMvtAlerte = true; showAlert(_m, "warning"); }
      else if (typeof toast === "function") toast(_m, "error");
    } catch(_e) {}
    return { ok:false, error:(e && e.message) || "erreur" };
  }
}
async function getMouvementsStock(prodId, limit) {
  if (!_isOnline || !_salonId) return [];
  try {
    var r = await _sb.from("mouvements_stock").select("*")
      .eq("salon_id", _salonId).eq("produit_id", prodId)
      .order("created_at", { ascending: false }).limit(limit || 50);
    return r.data || [];
  } catch(e) { return []; }
}

// ============================================================
// OPERATEURS NF525
// ============================================================

// Hash PIN avec salt unique par salon
async function hashPIN(pin, salonId) {
  var salt = "luxyra_op_" + salonId;
  var msg = pin + ":" + salt;
  var enc = new TextEncoder().encode(msg);
  var hashBuf = await crypto.subtle.digest("SHA-256", enc);
  var hashArr = Array.from(new Uint8Array(hashBuf));
  return hashArr.map(function(b){return b.toString(16).padStart(2,"0");}).join("");
}

// 2026-10-14 SECURITE : colonnes lisibles de salon_operateurs (pin_hash retiré : vérification par le serveur)
var LX_OP_COLONNES = "id,salon_id,prenom,nom,email,avatar_color,avatar_initials,role,pin_length,permissions,collab_id,actif,failed_attempts,locked_until,last_login_at,created_at,created_by";

// Charger tous les opérateurs du salon
async function loadOperateurs() {
  if (!_isOnline || !_salonId) return [];
  try {
    // 2026-10-14 SECURITE : colonnes explicites (pin_hash n'est plus lisible depuis l'application)
    var r = await _sb.from("salon_operateurs").select(LX_OP_COLONNES).eq("salon_id", _salonId).order("created_at");
    // FIX 2026-10-10 : une lecture ratée (réseau, base lente) renvoyait une liste VIDE -> bandeau orange
    // « NF525 — Configurez vos opérateurs » et passage sans code PIN. On signale l'échec (null) à la place.
    if (r.error || !Array.isArray(r.data)) { console.warn("[OP LOAD] lecture impossible :", r.error && r.error.message); return null; }
    return r.data;
  } catch(e) { console.error("[OP LOAD]", e.message); return null; }
}

// Créer un opérateur (avec hash du PIN)
async function createOperateur(data) {
  if (!_isOnline || !_salonId) return null;
  try {
    var pinHash = await hashPIN(data.pin, _salonId);
    var initials = ((data.prenom||"")[0]||"") + ((data.nom||"")[0]||"");
    var insert = {
      salon_id: _salonId,
      prenom: data.prenom,
      nom: data.nom || "",
      email: data.email || null,
      avatar_color: data.avatar_color || "#c8a84e",
      avatar_initials: initials.toUpperCase(),
      role: data.role || "collaborateur",
      pin_hash: pinHash,
      pin_length: data.pin.length,
      permissions: data.permissions || {},
      collab_id: data.collab_id || null,
      actif: true,
      failed_attempts: 0,
      created_by: (window.SALON_CONFIG && window.SALON_CONFIG.email) || null
    };
    var r = await _sb.from("salon_operateurs").insert(insert).select(LX_OP_COLONNES);
    if (r.error) throw r.error;
    try { if (typeof saveAuditEntry === "function") saveAuditEntry("OPERATEUR_CREE", "Opérateur " + (data.prenom || "") + " " + (data.nom || "") + " créé — rôle " + insert.role); } catch(_eA){}
    return r.data && r.data[0] ? r.data[0] : null;
  } catch(e) { console.error("[OP CREATE]", e.message); _lxEcritureAlerte("cr\u00e9ation de l'op\u00e9rateur", e, {}); return null; } // 2026-10-15 : raison affichee
}

// Mettre à jour un opérateur (sans toucher au PIN)
async function updateOperateur(id, data) {
  if (!_isOnline || !_salonId) return false;
  try {
    var update = {};
    if (data.prenom != null) update.prenom = data.prenom;
    if (data.nom != null) update.nom = data.nom;
    if (data.email != null) update.email = data.email;
    if (data.avatar_color != null) update.avatar_color = data.avatar_color;
    if (data.role != null) update.role = data.role;
    if (data.permissions != null) update.permissions = data.permissions;
    if (data.collab_id !== undefined) update.collab_id = data.collab_id;
    if (data.actif != null) update.actif = data.actif;
    if (data.prenom != null || data.nom != null) {
      var ini = ((data.prenom||"")[0]||"") + ((data.nom||"")[0]||"");
      update.avatar_initials = ini.toUpperCase();
    }
    var r = await _sb.from("salon_operateurs").update(update).eq("id", id).select("id");
    // 2026-10-14 : 0 ligne modifiee (droits refuses) = echec, pas un succes silencieux
    if (!r.error && (!r.data || !r.data.length)) { console.error("[OP UPDATE] 0 ligne modifiee", id); _lxEcritureAlerte("modification de l'op\u00e9rateur", { message: "aucune modification accept\u00e9e par le serveur" }, {}); return false; }
    if (r.error) _lxEcritureAlerte("modification de l'op\u00e9rateur", r.error, {}); // 2026-10-15
    // 2026-10-11 (NF525, JET 130) : trace des changements d'habilitations
    try { if (!r.error && (update.role != null || update.permissions != null || update.actif != null) && typeof saveAuditEntry === "function")
      saveAuditEntry(update.permissions != null ? "OPERATEUR_PERMISSIONS" : "OPERATEUR_ROLE", "Opérateur " + id + " : " + JSON.stringify({ role: update.role, actif: update.actif, permissions: update.permissions }).slice(0, 700)); } catch(_eA){}
    return !r.error;
  } catch(e) { console.error("[OP UPDATE]", e.message); _lxEcritureAlerte("modification de l'op\u00e9rateur", e, {}); return false; }
}

// Changer le PIN d'un opérateur
async function changeOperateurPIN(id, newPin) {
  if (!_isOnline || !_salonId) return false;
  try {
    var pinHash = await hashPIN(newPin, _salonId);
    // 2026-10-14 : le compteur d'erreurs est remis à zéro par la base (trigger) — plus écrit par l'application
    var r = await _sb.from("salon_operateurs").update({
      pin_hash: pinHash,
      pin_length: newPin.length
    }).eq("id", id).select("id"); // 2026-10-14 audit : lignes réellement modifiées
    if (r.error) { console.error("[OP PIN]", r.error.message); _lxEcritureAlerte("nouveau code PIN", r.error, {}); return false; }
    if (!r.data || !r.data.length) { console.error("[OP PIN] 0 ligne modifiée (droits refusés ou opérateur introuvable)", id); _lxEcritureAlerte("nouveau code PIN", { message: "aucune modification accept\u00e9e par le serveur" }, {}); return false; } // 2026-10-14 audit : avant = succès annoncé à tort
    try { if (typeof saveAuditEntry === "function") saveAuditEntry("OPERATEUR_PIN_MODIFIE", "Opérateur " + id + " : code PIN modifié"); } catch(_eA){}
    try { _lxOpCacheOublier(id); } catch(_eC){}
    return true;
  } catch(e) { console.error("[OP PIN]", e.message); _lxEcritureAlerte("nouveau code PIN", e, {}); return false; }
}

// Supprimer un opérateur
async function deleteOperateur(id) {
  if (!_isOnline || !_salonId) return false;
  try {
    var r = await _sb.from("salon_operateurs").delete().eq("id", id).select("id");
    // 2026-10-14 : 0 ligne supprimee (droits refuses) = echec
    if (!r.error && (!r.data || !r.data.length)) { console.error("[OP DEL] 0 ligne supprimee", id); _lxEcritureAlerte("suppression de l'op\u00e9rateur", { message: "aucune modification accept\u00e9e par le serveur" }, {}); return false; }
    if (r.error) _lxEcritureAlerte("suppression de l'op\u00e9rateur", r.error, {}); // 2026-10-15
    try { if (!r.error && typeof saveAuditEntry === "function") saveAuditEntry("OPERATEUR_SUPPRIME", "Opérateur " + id + " supprimé"); } catch(_eA){}
    return !r.error;
  } catch(e) { console.error("[OP DEL]", e.message); _lxEcritureAlerte("suppression de l'op\u00e9rateur", e, {}); return false; }
}

// ------------------------------------------------------------
// 2026-10-14 SECURITE : le PIN est vérifié PAR LE SERVEUR (RPC operateur_verifier_pin, verrouillage compté en base) ;
// pin_hash n'est plus jamais lu par l'application.
// HORS LIGNE : la caisse ne doit jamais rester bloquée. Après chaque connexion réussie EN LIGNE, l'appareil garde
// une empreinte LOCALE salée et lente (PBKDF2-SHA256, 150 000 itérations, sel aléatoire propre à l'appareil) du
// dernier PIN validé de cet opérateur. Sans réseau, le PIN est comparé à cette empreinte, avec son propre compteur
// (5 erreurs -> 30 min). Rien n'est envoyé au serveur ; l'empreinte est effacée au changement de PIN.
// ------------------------------------------------------------
var LX_OPC_MAX_JOURS = 30;
function _lxOpCacheCle() { return "lx_opc_" + (_salonId || ""); }
function _lxOpCacheLire() { try { return JSON.parse(localStorage.getItem(_lxOpCacheCle()) || "{}") || {}; } catch (e) { return {}; } }
function _lxOpCacheEcrire(c) { try { localStorage.setItem(_lxOpCacheCle(), JSON.stringify(c)); } catch (e) {} }
function _lxOpCacheOublier(opId) { var c = _lxOpCacheLire(); if (c[opId]) { delete c[opId]; _lxOpCacheEcrire(c); } }
function _lxHex(buf) { return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join(""); }
function _lxUnhex(h) { var a = new Uint8Array(h.length / 2); for (var i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16); return a; }
async function _lxPinLocalHash(pin, selHex, iter) {
  var km = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(pin) + "|" + (_salonId || "")), "PBKDF2", false, ["deriveBits"]);
  var bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: _lxUnhex(selHex), iterations: iter, hash: "SHA-256" }, km, 256);
  return _lxHex(bits);
}
// Opérateur sans données sensibles (copie locale pour le mode hors ligne)
function _lxOpCopie(op) {
  if (!op) return null;
  return { id: op.id, salon_id: op.salon_id, prenom: op.prenom, nom: op.nom, email: op.email, avatar_color: op.avatar_color,
    avatar_initials: op.avatar_initials, role: op.role, pin_length: op.pin_length, permissions: op.permissions || {},
    collab_id: op.collab_id, actif: op.actif };
}
async function _lxOpCacheMemoriser(op, pin) {
  try {
    if (!op || !op.id || !window.crypto || !crypto.subtle) return;
    var c = _lxOpCacheLire(), old = c[op.id] || null, e;
    if (pin != null) { var sel = _lxHex(crypto.getRandomValues(new Uint8Array(16))); e = { s: sel, i: 150000, h: await _lxPinLocalHash(pin, sel, 150000) }; }
    else if (old && old.h) e = { s: old.s, i: old.i, h: old.h }; // biométrie : on garde l'empreinte du dernier PIN
    else e = { s: null, i: null, h: null };                       // biométrie seule : profil gardé pour la biométrie hors ligne
    e.t = Date.now(); e.op = _lxOpCopie(op); e.f = 0; e.lu = null;
    c[op.id] = e; _lxOpCacheEcrire(c);
  } catch (e) {}
}
function _lxEstHorsLigne(err) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  var m = String((err && (err.message || err.details)) || err || "");
  return /Failed to fetch|NetworkError|Load failed|network|fetch failed|timeout|ERR_INTERNET/i.test(m);
}
async function _lxOperatorLoginHorsLigne(operatorId, pin) {
  var c = _lxOpCacheLire(), e = c[operatorId];
  if (!e || !e.h || !e.op || (Date.now() - (e.t || 0)) > LX_OPC_MAX_JOURS * 864e5) {
    return { ok: false, offline: true, error: "Hors ligne : ce profil ne s'est jamais connecté sur cet appareil (ou depuis plus de " + LX_OPC_MAX_JOURS + " jours). Connectez-vous une fois avec Internet." };
  }
  if (e.lu && e.lu > Date.now()) return { ok: false, offline: true, error: "Compte verrouillé (trop d'erreurs)", locked: true, remaining: 0, max: 5, lockedUntil: new Date(e.lu).toISOString() };
  var h = await _lxPinLocalHash(pin, e.s, e.i || 150000);
  if (h !== e.h) {
    e.f = (e.lu && e.lu <= Date.now()) ? 1 : (e.f || 0) + 1;
    e.lu = e.f >= 5 ? Date.now() + 30 * 60 * 1000 : null;
    c[operatorId] = e; _lxOpCacheEcrire(c);
    return { ok: false, offline: true, error: "PIN incorrect (" + e.f + "/5)", locked: e.f >= 5, fails: e.f, remaining: Math.max(0, 5 - e.f), max: 5, lockedUntil: e.lu ? new Date(e.lu).toISOString() : null };
  }
  e.f = 0; e.lu = null; c[operatorId] = e; _lxOpCacheEcrire(c);
  window._lxOpConnexionHorsLigne = true;
  return { ok: true, offline: true, op: Object.assign({}, e.op) };
}

// 2026-10-14 (fenêtre de déploiement) : tant que secu.sql n'est pas appliqué, les RPC operateur_* n'existent pas encore.
// Fonction absente (PGRST202 / 42883 / « Could not find the function ») -> ANCIEN chemin (lecture de pin_hash + hashPIN),
// pour que la caisse ne se bloque jamais pendant le déploiement. Toute AUTRE erreur reste bloquante (fail-closed).
function _lxRpcAbsente(err) {
  if (!err) return false;
  var c = String(err.code || ""), m = String(err.message || "") + " " + String(err.details || "") + " " + String(err.hint || "");
  return c === "PGRST202" || c === "42883" || /Could not find the function/i.test(m);
}
function _lxOpSansPin(op) { var o = Object.assign({}, op || {}); delete o.pin_hash; return o; }
async function _lxOperatorLoginAncien(operatorId, pin) {
  var r = await _sb.from("salon_operateurs").select("*").eq("id", operatorId).limit(1);
  if (r.error) return {ok:false, error:r.error.message || "Erreur"};
  if (!r.data || !r.data.length) return {ok:false, error:"Op\u00e9rateur introuvable"};
  var op = r.data[0];
  if (!op.actif) return {ok:false, error:"Compte d\u00e9sactiv\u00e9"};
  if (op.locked_until && new Date(op.locked_until) > new Date()) {
    return {ok:false, error:"Compte verrouill\u00e9 (trop d'erreurs)", locked:true, remaining:0, max:5, lockedUntil:op.locked_until};
  }
  if (!op.pin_hash) return {ok:false, error:"V\u00e9rification du PIN impossible"}; // colonne non lisible : jamais de connexion sans contrôle
  var pinHash = await hashPIN(String(pin || ""), _salonId);
  if (pinHash !== op.pin_hash) {
    var fails = (op.failed_attempts || 0) + 1;
    var update = {failed_attempts: fails};
    if (fails >= 5) update.locked_until = new Date(Date.now() + 30*60*1000).toISOString();
    await _sb.from("salon_operateurs").update(update).eq("id", operatorId);
    return {ok:false, error:"PIN incorrect ("+fails+"/5)", locked:fails>=5, fails:fails, remaining:Math.max(0,5-fails), max:5, lockedUntil:update.locked_until||null};
  }
  await _sb.from("salon_operateurs").update({ failed_attempts: 0, locked_until: null, last_login_at: new Date().toISOString() }).eq("id", operatorId);
  return {ok:true, op:_lxOpSansPin(op)};
}
async function _lxOperatorBioAncien(operatorId) {
  var r = await _sb.from("salon_operateurs").select(LX_OP_COLONNES).eq("id", operatorId).limit(1);
  if (r.error) return {ok:false, error:r.error.message || "Erreur"};
  if (!r.data || !r.data.length) return {ok:false, error:"Op\u00e9rateur introuvable"};
  var op = r.data[0];
  if (!op.actif) return {ok:false, error:"Compte d\u00e9sactiv\u00e9"};
  if (op.locked_until && new Date(op.locked_until) > new Date()) return {ok:false, error:"Compte verrouill\u00e9 (trop d'erreurs)", locked:true};
  await _sb.from("salon_operateurs").update({ failed_attempts: 0, last_login_at: new Date().toISOString() }).eq("id", operatorId);
  return {ok:true, op:_lxOpSansPin(op)};
}
async function _lxUnlockAncien(id) {
  var r = await _sb.from("salon_operateurs").update({ failed_attempts: 0, locked_until: null }).eq("id", id).select("id");
  if (r.error) { console.error("[OP UNLOCK ancien]", r.error.message); return {ok:false, error:r.error.message}; }
  if (!r.data || !r.data.length) return {ok:false, error:"Déblocage impossible (droits refusés)"};
  return {ok:true};
}

// Tenter login avec PIN — retourne {ok:true, op:...} ou {ok:false, error:..., locked:bool}
async function operatorLogin(operatorId, pin) {
  if (!_salonId) return {ok:false, error:"Hors ligne"};
  if (!_isOnline || (typeof navigator !== "undefined" && navigator.onLine === false)) return await _lxOperatorLoginHorsLigne(operatorId, pin);
  try {
    var r = await _sb.rpc("operateur_verifier_pin", { p_operateur_id: operatorId, p_pin: String(pin || "") });
    if (r.error && _lxRpcAbsente(r.error)) {
      // RPC pas encore déployée : ancien contrôle (empreinte relue en base)
      var ra = await _lxOperatorLoginAncien(operatorId, pin);
      if (ra.ok) { window._lxOpConnexionHorsLigne = false; await _lxOpCacheMemoriser(ra.op, pin); }
      return ra;
    }
    if (r.error) {
      if (_lxEstHorsLigne(r.error)) return await _lxOperatorLoginHorsLigne(operatorId, pin);
      return {ok:false, error:r.error.message || "Erreur"};
    }
    var d = r.data || {};
    if (d.ok && d.op) { window._lxOpConnexionHorsLigne = false; await _lxOpCacheMemoriser(d.op, pin); return {ok:true, op:d.op}; }
    if (d.locked || d.error === "Compte désactivé" || d.error === "Opérateur introuvable") _lxOpCacheOublier(operatorId);
    return {ok:false, error:d.error || "Code incorrect", locked:!!d.locked, fails:d.fails, remaining:d.remaining, max:d.max || 5, lockedUntil:d.lockedUntil || null};
  } catch(e) {
    if (_lxEstHorsLigne(e)) return await _lxOperatorLoginHorsLigne(operatorId, pin);
    console.error("[OP LOGIN]", e.message); return {ok:false, error:e.message};
  }
}

// 2026-10-10 : connexion après vérification biométrique PAR L'APPAREIL (WebAuthn) — mêmes contrôles que le PIN
// (opérateur actif, non verrouillé), sans code. 2026-10-14 : contrôle côté serveur (RPC) ; hors ligne, profil
// mémorisé sur cet appareil lors d'une connexion en ligne (même limite de 30 jours) — plus d'impasse sans réseau.
function _lxOperatorBioHorsLigne(operatorId) {
  var e = _lxOpCacheLire()[operatorId];
  if (!e || !e.op || (Date.now() - (e.t || 0)) > LX_OPC_MAX_JOURS * 864e5) return {ok:false, offline:true, error:"Hors ligne : connectez-vous une fois avec Internet sur cet appareil"};
  if (e.lu && e.lu > Date.now()) return {ok:false, offline:true, error:"Compte verrouillé (trop d'erreurs)", locked:true};
  window._lxOpConnexionHorsLigne = true;
  return {ok:true, offline:true, op:Object.assign({}, e.op)};
}
async function operatorLoginBio(operatorId) {
  if (!_salonId) return {ok:false, error:"Hors ligne"};
  if (!_isOnline || (typeof navigator !== "undefined" && navigator.onLine === false)) return _lxOperatorBioHorsLigne(operatorId);
  try {
    var r = await _sb.rpc("operateur_connexion_bio", { p_operateur_id: operatorId });
    if (r.error && _lxRpcAbsente(r.error)) {
      var rb = await _lxOperatorBioAncien(operatorId); // RPC pas encore déployée
      if (rb.ok) { window._lxOpConnexionHorsLigne = false; await _lxOpCacheMemoriser(rb.op, null); }
      return rb;
    }
    if (r.error) { if (_lxEstHorsLigne(r.error)) return _lxOperatorBioHorsLigne(operatorId); return {ok:false, error:r.error.message || "Erreur"}; }
    var d = r.data || {};
    if (d.ok && d.op) { window._lxOpConnexionHorsLigne = false; await _lxOpCacheMemoriser(d.op, null); return {ok:true, op:d.op}; }
    return {ok:false, error:d.error || "Connexion impossible", locked:!!d.locked};
  } catch(e) { if (_lxEstHorsLigne(e)) return _lxOperatorBioHorsLigne(operatorId); return {ok:false, error:e.message}; }
}

// Débloquer manuellement un opérateur (admin only) — 2026-10-14 : RPC (3 déblocages / heure / opérateur)
async function unlockOperateur(id) {
  if (!_isOnline || !_salonId) return false;
  try {
    var r = await _sb.rpc("operateur_debloquer", { p_operateur_id: id });
    if (r.error && _lxRpcAbsente(r.error)) r = { data: await _lxUnlockAncien(id), error: null }; // RPC pas encore déployée
    if (r.error) { console.error("[OP UNLOCK]", r.error.message); return false; }
    if (!r.data || !r.data.ok) { try { if (typeof toast === "function") toast((r.data && r.data.error) || "Déblocage impossible", "warning"); } catch(_t){} return false; }
    try { var c = _lxOpCacheLire(); if (c[id]) { c[id].f = 0; c[id].lu = null; _lxOpCacheEcrire(c); } } catch(_c){}
    try { if (typeof saveAuditEntry === "function") saveAuditEntry("OPERATEUR_DEBLOQUE", "Opérateur " + id + " débloqué manuellement"); } catch(_eA){}
    return true;
  } catch(e) { return false; }
}

// ============================================================
// SYNC: rdv_online client → salon clients table
// ============================================================
async function syncClientFromOnlineRdv(rdvData) {
  if (!_isOnline || !_salonId) return null;
  // FIX 2026-05-18 : matching robuste via colonnes normalisées
  // (téléphone sans espaces/tirets/+33, email lowercase trim)
  // Évite les doublons quand l'orthographe / le format diffère entre l'inscription
  // chez le salon et le compte Luxyra du client.
  var email = (rdvData.client_email || "").trim().toLowerCase();
  var bpId = rdvData.client_luxyra_id || null;
  var existing = null;
  // 1) Lien explicite client_luxyra_id
  if (bpId) {
    var r = await _sb.from("clients").select("*").eq("salon_id", _salonId).eq("client_luxyra_id", bpId).limit(1);
    if (r.data && r.data.length) existing = r.data[0];
  }
  // 2) Email normalisé (lowercase)
  if (!existing && email) {
    var r2 = await _sb.from("clients").select("*").eq("salon_id", _salonId).eq("email_norm", email).limit(1);
    if (r2.data && r2.data.length) existing = r2.data[0];
  }
  // 3) Téléphone normalisé (mêmes règles que la fonction DB normalize_phone)
  if (!existing && rdvData.client_telephone) {
    var phNorm = String(rdvData.client_telephone||"").replace(/[^0-9]/g,"");
    if (phNorm.length === 11 && phNorm.indexOf("33") === 0) phNorm = "0" + phNorm.substring(2);
    if (phNorm.length === 13 && phNorm.indexOf("0033") === 0) phNorm = "0" + phNorm.substring(4);
    if (phNorm.length >= 8) {
      var r3 = await _sb.from("clients").select("*").eq("salon_id", _salonId).eq("telephone_norm", phNorm).limit(1);
      if (r3.data && r3.data.length) existing = r3.data[0];
    }
  }
  // 2026-10-11 : réservation faite POUR une autre personne depuis le compte du titulaire (même email /
  // téléphone / compte Luxyra) -> on ne rattache pas au titulaire : fiche au nom de la personne réservée.
  var _nn = function (x) { return String(x || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, ""); };
  var _pOk = function (a, b) { a = _nn(a); b = _nn(b); if (!a || !b || a === b) return true; return a.length >= 3 && b.length >= 3 && (a.indexOf(b) === 0 || b.indexOf(a) === 0); };
  if (existing && rdvData.client_prenom && !_pOk(existing.prenom, rdvData.client_prenom)) {
    existing = null; bpId = null;
    try {
      var rn = await _sb.from("clients").select("*").eq("salon_id", _salonId).ilike("prenom", String(rdvData.client_prenom).trim()).ilike("nom", String(rdvData.client_nom || "").trim()).limit(1);
      if (rn.data && rn.data.length) return rn.data[0].id;
    } catch (_eN) {}
  }
  // 4) 2026-10-13 : même nom + même prénom, UNE seule fiche, sans e-mail (ou le même) -> c'est la même personne
  //    (cas réel : fiche salon avec un téléphone mal saisi, puis compte en ligne -> 2 fiches et fidélité séparée).
  var _nomSeul = false; // 2026-10-14 audit : fiche retrouvée par le NOM seulement (homonyme possible)
  if (!existing && rdvData.client_nom && rdvData.client_prenom) {
    try {
      var r4 = await _sb.from("clients").select("*").eq("salon_id", _salonId).is("fusionne_dans", null)
        .ilike("nom", String(rdvData.client_nom).trim()).ilike("prenom", String(rdvData.client_prenom).trim()).limit(2);
      if (r4.data && r4.data.length === 1) {
        var c4 = r4.data[0], e4 = String(c4.email || "").trim().toLowerCase();
        if (!e4 || !email || e4 === email) {
          existing = c4; _nomSeul = !(e4 && email && e4 === email);
          // 2026-10-14 audit : on n'écrit PLUS l'e-mail du compte en ligne sur une fiche retrouvée par le nom seul
          // (homonyme : la fiche d'une autre personne aurait été rattachée à ce compte, consentement compris).
        }
      }
    } catch (_eN4) {}
  }
  if (existing) {
    // Link beautypro_id if not set
    // 2026-10-14 audit : jamais sur une correspondance par le nom seul (lien vers un inconnu)
    if (bpId && !existing.client_luxyra_id && !_nomSeul) {
      await _sb.from("clients").update({ client_luxyra_id: bpId }).eq("id", existing.id);
    }
    return existing.id;
  }
  // Create new client
  var newClient = {
    salon_id: _salonId,
    nom: rdvData.client_nom || "",
    prenom: rdvData.client_prenom || "",
    telephone: rdvData.client_telephone || "",
    email: email,
    client_luxyra_id: bpId,
    sexe: rdvData.client_genre || null,
    date_naissance: rdvData.client_ddn || null,
    actif: true,
    // 2026-10-14 audit (RGPD) : plus de consentement SMS / e-mail présumé (avant : true). Fiche liée à un compte
    // Luxyra : le consentement du compte est recopié par la base (clients_consentement_depuis_compte,
    // docs/migrations_1014/donnees.sql) ; sinon il reste à recueillir.
    sms_ok: false,
    email_ok: false,
    acquisition_source: "en_ligne",
    created_at: new Date().toISOString()
  };
  var res = await _sb.from("clients").insert(newClient).select();
  if (res.data && res.data[0]) { try { window._lxFichesCreeesEnLigne = window._lxFichesCreeesEnLigne || {}; window._lxFichesCreeesEnLigne[res.data[0].id] = res.data[0]; } catch(_eF) {} return res.data[0].id; }
  return null;
}

// Update fidelite_client cross-salon table
async function updateFideliteClient(bpId, salonId, salonNom, currentFid, hasPrestation) {
  if (!_isOnline || !bpId) return;
  var fidconf = window.FIDCONF || { seuil: 10, remise: 10 };
  var pts = (typeof currentFid === "number") ? currentFid : null;
  var countVisit = hasPrestation !== false;
  try {
    var r = await _sb.from("fidelite_client").select("*").eq("client_luxyra_id", bpId).eq("salon_id", salonId).limit(1);
    if (r.data && r.data.length) {
      var f = r.data[0];
      var updateData = {
        points: pts !== null ? pts : (f.points || 0) + 1,
        derniere_visite: new Date().toISOString().slice(0, 10),
        salon_nom: salonNom || SALON_CONFIG.nom,
        seuil_fidelite: fidconf.seuil || 10,
        remise_fidelite: fidconf.remise || 10,
        remise_type: fidconf.type || "amount",
        updated_at: new Date().toISOString()
      };
      if (countVisit) updateData.visites = (f.visites || 0) + 1;
      await lxEcritureVerifiee(_sb.from("fidelite_client").update(updateData).eq("id", f.id).select("id"), "points de fidélité du compte client", { toast:true }); // 2026-10-15
    } else {
      await lxEcritureVerifiee(_sb.from("fidelite_client").insert({
        client_luxyra_id: bpId,
        salon_id: salonId,
        salon_nom: salonNom || SALON_CONFIG.nom,
        points: pts !== null ? pts : 1,
        visites: countVisit ? 1 : 0,
        derniere_visite: new Date().toISOString().slice(0, 10),
        seuil_fidelite: fidconf.seuil || 10,
        remise_fidelite: fidconf.remise || 10,
        remise_type: fidconf.type || "amount"
      }).select("id"), "carte de fidélité du compte client", { toast:true });
    }
  } catch(e) { console.log("[FIDELITE]", e.message); }
}

// ============================================================
// HOOKS — À injecter dans le code existant de l'app
// ============================================================
// 
// Dans le code existant, après chaque action qui modifie les données,
// appeler la fonction save correspondante. Exemples :
//
// Après création/modif d'un client :
//   saveClient(CL[index]);
//
// Après encaissement d'un ticket :
//   saveAppointment(AP[index]);
//   saveAuditEntry("ENCAISSEMENT", "Ticket #" + tk.tkNum + " - " + tk.pr + "€");
//
// Après clôture Z :
//   saveCloture(cloture);
//   saveAuditEntry("CLOTURE_Z", "Z#" + cloture.num);
//
// Après modif config salon :
//   saveSalonConfig();
//
// Après modif stock produit :
//   saveProduct(PRODS[index]);
//
// IMPORTANT : ces appels sont async mais on n'attend pas le résultat
// pour ne pas bloquer l'UI. Les erreurs sont loguées en console.


// ============================================================
// INIT — Démarrage de l'app
// ============================================================

// Wrapper : remplace l'ancienne fonction auditLog pour sauver aussi en base
var _originalAuditLog = null;

function auditLogWrapper(action, detail) {
  // Appeler l'original (ajoute dans window.AUDIT_LOG en mémoire)
  if (_originalAuditLog) _originalAuditLog(action, detail);
  // Sauver en base
  console.log("[AUDIT] " + action + " - " + (detail || ""));
  saveAuditEntry(action, detail);
}

// Installer le wrapper auditLog. Robuste : ré-appelable plusieurs fois.
function installAuditWrapper() {
  if (typeof window.auditLog !== "function") return false;
  if (window.auditLog === auditLogWrapper) return true; // déjà installé
  _originalAuditLog = window.auditLog;
  window.auditLog = auditLogWrapper;
  console.log("[NF525] auditLog wrapper installé (persistance en base activée)");
  return true;
}

// Installation immédiate si possible
if (typeof window.auditLog === "function") {
  installAuditWrapper();
}

// Au chargement de la page, réessayer d'installer le wrapper + checkSession
document.addEventListener("DOMContentLoaded", function() {
  if (!installAuditWrapper()) {
    // auditLog pas encore défini -> retry périodique pendant 3 secondes max
    var retries = 0;
    var retryInterval = setInterval(function(){
      retries++;
      if (installAuditWrapper() || retries > 30) {
        clearInterval(retryInterval);
        if (retries > 30 && typeof window.auditLog !== "function") {
          console.error("[NF525] auditLog introuvable après 3s - les logs ne seront PAS persistés en base");
        }
      }
    }, 100);
  }
  // Vérifier session
  checkSession();
});
