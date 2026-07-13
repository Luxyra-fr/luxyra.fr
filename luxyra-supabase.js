// ============================================================
// LUXYRA — MODULE SUPABASE (luxyra-supabase.js)
// ============================================================
// BUILD: 20260426-04 — fix CSS options dropdown lisibles
window.__LUXYRA_BUILD = "20260426-04";
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
  _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
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

function _walPersist(type, data){
  try {
    var wal = JSON.parse(localStorage.getItem(_WAL_KEY)||"[]");
    var entry = {
      id: "wal_" + Date.now() + "_" + Math.random().toString(36).slice(2,8),
      type: type,
      data: data,
      salon_id: _salonId,
      ts: new Date().toISOString(),
      synced: false
    };
    wal.push(entry);
    if (wal.length > _WAL_MAX) wal = wal.slice(-_WAL_MAX);
    localStorage.setItem(_WAL_KEY, JSON.stringify(wal));
    return entry.id;
  } catch(e){ console.warn("[WAL] persist failed:", e); return null; }
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
      var syncedTs = e.syncedAt ? new Date(e.syncedAt).getTime() : 0;
      return syncedTs > weekAgo;
    });
    if (kept.length !== wal.length) localStorage.setItem(_WAL_KEY, JSON.stringify(kept));
  } catch(e){}
}

async function _walCheck(){
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
    var AUTO_THRESHOLD = 20;
    if (unsynced.length > AUTO_THRESHOLD) {
      console.warn("[WAL] Beaucoup d'actions non-sync ("+unsynced.length+") → modale de confirmation");
      if (typeof window.showWalRecovery === "function") window.showWalRecovery(unsynced);
      return;
    }

    // Récupération auto en arrière-plan
    var ok = 0, fail = 0;
    for (var i = 0; i < unsynced.length; i++) {
      try {
        var r = await _walResync(unsynced[i].id);
        if (r && r.ok) ok++; else fail++;
      } catch(_) { fail++; }
    }

    // Si trop d'échecs (>50%), on bascule sur la modale pour que l'utilisateur sache
    if (fail > 0 && fail >= unsynced.length / 2) {
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

async function _walResync(walId){
  try {
    var wal = JSON.parse(localStorage.getItem(_WAL_KEY)||"[]");
    var entry = null;
    for (var i=0; i<wal.length; i++) { if (wal[i].id===walId) { entry=wal[i]; break; } }
    if (!entry || entry.synced) return { ok: false, reason: "introuvable ou déjà sync" };
    var fn = ({
      client: saveClient,
      appointment: saveAppointment,
      ticket: saveTicketToDb,
      cloture: saveCloture
    })[entry.type];
    if (!fn) return { ok: false, reason: "type non géré: " + entry.type };
    // Bypass WAL pour éviter récursion (la 2ème save ne re-persiste pas)
    window._walBypass = true;
    try { await fn(entry.data); } finally { window._walBypass = false; }
    _walMarkSynced(walId);
    return { ok: true };
  } catch(e){
    return { ok: false, reason: e.message || String(e) };
  }
}

window._walResync = _walResync;
window._walCheck = _walCheck;
window._walGetAll = function(){ try { return JSON.parse(localStorage.getItem(_WAL_KEY)||"[]"); } catch(e){ return []; } };

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
  // Clear le cache IndexedDB du salon courant AVANT de perdre _salonId
  // (sécurité : un user qui se déconnecte ne doit pas laisser ses data sur la machine)
  if (_salonId) {
    try { await clearCacheForSalon(_salonId); } catch(e){}
  }
  if (_sb) await _sb.auth.signOut();
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
  if (!_sb) { startOffline(); return; }
  try{
  var result = await _sb.auth.getSession();
  if (result.data && result.data.session) {
    // Check inactivité salon avant de restaurer
    var lastSalonActivity = parseInt(localStorage.getItem("lx_salon_last_activity") || "0", 10);
    var elapsed = lastSalonActivity ? (Date.now() - lastSalonActivity) : Infinity;
    if (elapsed > SALON_SESSION_INACTIVITY_MS) {
      // Session salon expirée → signOut Supabase + cleanup + login screen.
      // On vide aussi lx_current_op pour forcer le re-PIN après re-login
      // (sinon Amandine resterait active après que le salon se reconnecte).
      try { await _sb.auth.signOut(); } catch(_){}
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
    try { localStorage.removeItem("lx_salon_last_activity"); } catch(_){}
    showLoginScreen();
  }
  }catch(err){showLoginScreen();}
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
          cId: p.client_id || raw.cId || "",
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
      // Expirer les devis périmés non marqués (best-effort, fire-and-forget)
      try { _sb.rpc("devis_expire_overdue").catch(function(){}); } catch(e0) {}
      window.DEVIS = dvRes.data.map(function(d) {
        var raw = (d.raw_data && typeof d.raw_data === "object") ? d.raw_data : {};
        return Object.assign({}, raw, {
          dbId: d.id, num: d.num, date: d.date_devis, dateValidite: d.date_validite,
          cId: d.client_id, clientName: d.client_nom || "",
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
  var txTVA = base.txTVA || 20;
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
function lxMapApptRow(a) {
  // FIX 2026-05-13 : reconstruit cId="passage-X" depuis la colonne pass_type
  // (preserve le genre choisi au RDV meme apres un reload / un merge).
  var _cId = a.client_id;
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
        break;
      }
    }
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
  return _ap;
}
if (typeof window !== "undefined") window.lxMapApptRow = lxMapApptRow;

async function loadSalonData() {
  if (!_sb || !_userId) { startOffline(); return; }
  try{

  // 1. Charger le salon
  var sRes = await _sb.from("salons").select("*").eq("user_id", _userId).limit(1);
  if (sRes.error || !sRes.data || sRes.data.length === 0) {
    // Session existe mais aucun salon lié au user → on déconnecte proprement
    // (évite le "zombie state" où l'UI se charge sans données)
    console.warn("[loadSalonData] Aucun salon trouvé pour user_id="+_userId+", déconnexion");
    try{ await _sb.auth.signOut(); }catch(_){}
    _userId = null;
    _salonId = null;
    window._salonId = null;
    showLoginScreen();
    setTimeout(function(){ showLoginError && showLoginError("Aucun salon lié à ce compte. Reconnectez-vous avec le bon email."); }, 150);
    return;
  }

  var salon = sRes.data[0];
  _salonId = salon.id;
  window._salonId = salon.id; // expose explicitement pour app.html (startCheckout, etc.)
  _isOnline = true;

  // Flush queue d'erreurs JS pré-login (hook window.onerror — voir app.html)
  try { if (typeof window._lxFlushErrorQueue === "function") window._lxFlushErrorQueue(); } catch(_){}

  // WAL : vérifier s'il y a des actions non synchronisées et proposer récupération
  // (filet 15/05/2026 — voir bloc WAL en haut de ce fichier)
  setTimeout(function(){ try{ _walCheck(); }catch(_){} }, 2000);

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
  if (salon.status === "suspended" || salon.status === "cancelled") {
    // Mode Archives : si l'utilisateur a explicitement choisi d'accéder à ses
    // documents comptables (lecture seule), on continue le chargement normal mais
    // avec le flag _archiveMode qui désactive toutes les écritures côté UI.
    // Le flag est posé par showSuspendedScreen → bouton "Accéder à mes archives"
    // (sessionStorage = nettoyé à fermeture onglet, pas localStorage).
    if (sessionStorage.getItem("luxyra_archive_mode") === "1" && salon.status === "cancelled") {
      window._archiveMode = true;
      window._archiveSalon = salon;
      // Continue le chargement normal — le bandeau + le verrouillage des routes
      // sont injectés par enterArchiveMode() après que l'app soit montée.
    } else {
      showSuspendedScreen(salon.status, salon);
      return;
    }
  }

  // Vérifier si plan offert (gratuit)
  if(salon.is_free){
    // Check if free plan has expired
    if(salon.free_until){
      var freeEnd=new Date(salon.free_until);
      if(new Date()>freeEnd){
        // Free plan expired, revert to trial
        salon.is_free=false;
        _sb.from("salons").update({is_free:false}).eq("id",salon.id);
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
  SALON_CONFIG.adresse = salon.adresse || "";
  SALON_CONFIG.cp = salon.cp || "";
  SALON_CONFIG.ville = salon.ville || "";
  SALON_CONFIG.tel = salon.tel || "";
  SALON_CONFIG.email = salon.email || "";
  SALON_CONFIG.siteWeb = salon.site_web || "";
  SALON_CONFIG.siret = salon.siret || "";
  SALON_CONFIG.tva = salon.tva || "";
  SALON_CONFIG.couleurPrimaire = salon.couleur_primaire || "#c8a84e";
  SALON_CONFIG.couleurSecondaire = salon.couleur_secondaire || "#1a1a1a";
  SALON_CONFIG.subdomain = salon.subdomain || "";
  SALON_CONFIG.tauxTVA = salon.taux_tva || 20;
  SALON_CONFIG.tvaProduits = (salon.taux_tva_produits != null) ? Number(salon.taux_tva_produits) : SALON_CONFIG.tauxTVA;
  SALON_CONFIG.plan = salon.plan || "essential";
  SALON_CONFIG.metier = salon.metier || "coiffure";
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
  var hasAllDocs = salon.documents_kbis && salon.documents_id;
  if (!salon.is_free && salon.status === "active" && salon.stripe_subscription_id && !hasAllDocs) {
    var subStart = salon.contrat_accepted_at || salon.cgv_accepted_at || salon.created_at;
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
});if(cfg.sms_config)window.SMS_CONFIG=cfg.sms_config;if(cfg.prodcolors){window.PRODCOLORS=cfg.prodcolors;try{localStorage.setItem("_lx_prodcolors",JSON.stringify(cfg.prodcolors));}catch(e){}}if(cfg.svccolors){window.SVCCOLORS=cfg.svccolors;try{localStorage.setItem("_lx_svccolors",JSON.stringify(cfg.svccolors));}catch(e){}}if(cfg.validite_devis)SALON_CONFIG.validiteDevis=Number(cfg.validite_devis);if(Array.isArray(cfg.categories))window._cfgCategories=cfg.categories.slice();if(Array.isArray(cfg.categories_services))window._cfgCatsSvc=cfg.categories_services.slice();if(Array.isArray(cfg.categories_forfaits))window._cfgCatsForf=cfg.categories_forfaits.slice();if(typeof cfg.facebookUrl==="string")SALON_CONFIG.facebookUrl=cfg.facebookUrl;if(typeof cfg.instagramUrl==="string")SALON_CONFIG.instagramUrl=cfg.instagramUrl;if(typeof cfg.tiktokUrl==="string")SALON_CONFIG.tiktokUrl=cfg.tiktokUrl;}catch(e){}}
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
    if (tRes.data) {
      T = tRes.data.map(function(c) {
        return { id: c.id, n: c.nom, i: c.initiales, c: c.couleur, img: c.img || "",
                 hrs: c.horaires || {}, pause: c.pause || null,
                 // FIX 2026-05-12 : nouveau champ horaires_overrides (mode Personnalisés)
                 // Format : { "YYYY-MM-DD": {o,c,pause_o?,pause_c?} | null }
                 hrsOver: c.horaires_overrides || {},
                 dateEntree: c.date_entree || null, dateDepart: c.date_depart || null,
                 inactif: c.inactif === true,
                 photoVisible: c.photo_visible !== false,
                 competences: c.competences || {all:true} };
      });
    }
  } catch(e) { console.warn("[loadSalonData] collaborateurs skipped", e); }

  // 4. Charger services → SVC[]
  try {
    // Tri par catégorie puis par ordre personnalisé (NULL en dernier) puis nom
    var svcRes = await _sb.from("services").select("*").eq("salon_id", _salonId)
      .order("categorie", {ascending: true})
      .order("ordre", {ascending: true, nullsFirst: false})
      .order("nom", {ascending: true});
    if (svcRes.data) {
      SVC = svcRes.data.map(function(s) {
        return { id: s.id, n: s.nom, p: Number(s.prix), cat: s.categorie, ordre: s.ordre, phases: s.phases || [], showSite: s.show_site !== false, bookOnline: s.book_online !== false, catGenre: s.cat_genre || null };
      });
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
      if (Array.isArray(window._cfgCategories)) {
        window._cfgCategories.forEach(function(c){
          if (!c) return;
          if (window.CATS_SVC.indexOf(c) < 0) window.CATS_SVC.push(c);
          if (window.CATS_FORF.indexOf(c) < 0) window.CATS_FORF.push(c);
        });
      }

      // Salon vierge ? Applique les defaultCats du métier en SERVICES
      if (!window.CATS_SVC.length && !window.CATS_FORF.length
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
      CL = clRes.data.map(function(c) {
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
          // Acquisition source (Quick Win 2026-05-06)
          acqSrc: c.acquisition_source || null,
          acqParrain: c.acquisition_parrain || null,
          // Liens famille (mai 2026)
          famille_ids: Array.isArray(c.famille_ids) ? c.famille_ids : []
        };
        // Déballe la fiche technique étendue (peau, ongles, bien-être,
        // formules couleur, photos…) sur l'objet client. Le code UI
        // existant lit directement c.typePeau / c.formules / c.photos /
        // etc. — pas besoin de toucher au rendu.
        if (c.fiche_tech && typeof c.fiche_tech === "object") {
          for (var k in c.fiche_tech) {
            if (Object.prototype.hasOwnProperty.call(c.fiche_tech, k)) {
              obj[k] = c.fiche_tech[k];
            }
          }
        }
        return obj;
      });
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
      AP = apRes.data.map(lxMapApptRow);
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
  var roRes = await _sb.from("rdv_online").select("*").eq("salon_id", _salonId).order("created_at", { ascending: false }).limit(500);
  if (roRes.data) {
    window.RDV_ONLINE = roRes.data.map(function(r) {
      return {
        id: r.id, salonId: r.salon_id,
        nom: r.client_nom, prenom: r.client_prenom, tel: r.client_tel, email: r.client_email,
        luxyraId: r.client_luxyra_id || null,
        svcId: r.service_id, svcNom: r.service_nom, svcPrix: Number(r.service_prix),
        items: r.items || null, // multi-prestation : array d'items si booking multi, sinon null
        collabId: r.collaborateur_id, collabNom: r.collaborateur_nom,
        date: r.date_rdv, heure: r.heure_rdv ? r.heure_rdv.slice(0,5) : null,
        duree: r.duree_minutes,
        acompte: Number(r.acompte_montant), acomptePaye: r.acompte_paye,
        acompteRembourse: r.acompte_rembourse || false, refundedAt: r.refunded_at || null, stripePaymentId: r.payment_intent_id || null,
        status: r.status, message: r.message,
        createdAt: r.created_at, confirmedAt: r.confirmed_at,
        isOnline: true,
        // Empreinte bancaire (mai 2026)
        paymentIntentId: r.payment_intent_id || null,
        empreinteStatus: r.empreinte_status || "none",
        empreinteAmount: r.empreinte_amount ? Number(r.empreinte_amount) : null,
        empreinteHeldAt: r.empreinte_held_at || null,
        empreinteCapturedAt: r.empreinte_captured_at || null,
        empreinteReleasedAt: r.empreinte_released_at || null
      };
    });
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
    PRODS = prRes.data.map(function(p) {
      return {
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
      };
    });
    var pcatSet = {};
    PRODS.forEach(function(p) { if (p.cat) pcatSet[p.cat] = true; });
    PCATS = Object.keys(pcatSet);
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
        tvaRate: Number(g.tva_rate) || 0.20,
        history: g.history || [],
        tkNum: g.tk_num || null,
        themeId: g.theme_id || null,   // Style choisi par l'acheteur (bons en ligne)
        source: g.source || null,      // "web" = vente en ligne, sinon caisse
        buyerEmail: g.buyer_email || null,
        buyerPhone: g.buyer_phone || null
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
          cId: t.client_id || raw.cId || "passage",
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
    if (fRes.data && fRes.data.length > 0) {
      FORFAITS = fRes.data.map(function(f) {
        return { id: f.id, n: f.nom, p: Number(f.prix), cat: f.categorie || "", services: f.services || [], phases: f.phases || [], showSite: f.show_site !== false, bookOnline: f.book_online !== false, catGenre: f.cat_genre || null };
      });
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
  }catch(err){console.error("loadSalonData error:",err);}
}

function showSuspendedScreen(status, salon) {
  var el = document.getElementById("app") || document.body;
  // Traduction FR + style premium Luxyra (au lieu de "Compte cancelled" en anglais)
  var titre = status === "suspended" ? "Abonnement suspendu" : "Abonnement annulé";
  var msg   = status === "suspended"
    ? "Votre abonnement est suspendu suite à un défaut de paiement. Mettez à jour votre moyen de paiement pour réactiver l'accès immédiatement."
    : "Votre abonnement a été résilié. Vous pouvez reprendre un abonnement à tout moment, ou accéder à vos documents comptables en lecture seule.";
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
    +     '<button onclick="openCustomerPortal()" style="display:inline-flex;align-items:center;justify-content:center;gap:10px;padding:14px 28px;background:linear-gradient(135deg,#d4a843,#b8960f);color:#0a0a0a;font-weight:800;border:none;border-radius:12px;cursor:pointer;font-size:14px;letter-spacing:.5px;text-transform:uppercase;box-shadow:0 4px 16px rgba(212,168,67,.35);transition:all .2s;width:100%" onmouseover="this.style.transform=\'translateY(-1px)\';this.style.boxShadow=\'0 6px 20px rgba(212,168,67,.45)\'" onmouseout="this.style.transform=\'translateY(0)\';this.style.boxShadow=\'0 4px 16px rgba(212,168,67,.35)\'">'
    +       '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M7 15h0M2 9h20"/></svg>'
    +       (status === "suspended" ? 'Régulariser mon paiement' : 'Reprendre un abonnement')
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
function enterArchiveMode(){
  try {
    sessionStorage.setItem("luxyra_archive_mode", "1");
    sessionStorage.setItem("luxyra_archive_entered_at", new Date().toISOString());
  } catch(e){}
  window.location.reload();
}

// Quitter le mode archives (retour à l'écran "Abonnement annulé")
function exitArchiveMode(){
  try { sessionStorage.removeItem("luxyra_archive_mode"); } catch(e){}
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
    '<p style="color:#94a3b8;margin-bottom:24px;font-size:15px;line-height:1.6">Merci d\u2019avoir testé Luxyra !<br>Pour continuer à utiliser toutes les fonctionnalités, choisissez votre formule.</p>'+
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
  // Historique structuré par métier (barbier/esthétique/ongles/bien-être).
  // Coiffure utilise toujours `formules` ci-dessus pour les formules couleur.
  "histoMetier"
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
async function saveClient(client) {
  if (!_isOnline || !_salonId) return;
  // WAL : persiste l'action en LS AVANT tout traitement (filet 15/05/2026)
  var _walId = window._walBypass ? null : _walPersist("client", client);
  // Toast auto-save discret (debounced)
  // Construit le bucket fiche_tech à partir des champs étendus présents
  // sur l'objet client en mémoire. On ne pousse que les valeurs définies
  // pour ne pas écraser une fiche existante avec des undefined.
  var ft = {};
  _FICHE_TECH_KEYS.forEach(function(k){
    if (client[k] !== undefined && client[k] !== null) ft[k] = client[k];
  });
  var data = {
    salon_id: _salonId,
    nom: client.nom, prenom: client.pre, sexe: client.sex,
    telephone: client.ph, telephone2: client.ph2, email: client.em,
    adresse: client.adr, cp: client.cp, ville: client.ville,
    date_naissance: client.ddn, notes: client.no,
    nature_cheveux: client.natChev, type_cheveux: client.typeChev,
    details_cheveux: client.detChev, collab_pref: client.collab,
    actif: client.actif, points_fidelite: client.fid,
    sms_ok: client.smsOk, email_ok: client.emOk, fiches: client.fiches || [],
    acompte_online: client.acompteOnline || 'defaut',
    fiche_tech: ft,
    // Acquisition source (Quick Win 2026-05-06) — optionnel, NULL si pas renseigné
    acquisition_source: client.acqSrc || null,
    acquisition_parrain: client.acqParrain || null,
    // Liens famille (mai 2026) : array d'IDs UUID des clients liés
    famille_ids: client.famille_ids || []
  };
  // FIX 2026-05-12 : upsert avec id explicite (U() génère un UUID stable
  // dès la création) → INSERT ou UPDATE selon existence du PK. Plus de
  // mutation d'id, plus de race condition.
  _ensureUuidId(client);
  data.id = client.id;
  var res = await _sb.from("clients").upsert(data).select();
  if (res.error) console.error("saveClient upsert error:", res.error);
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
      if (Object.keys(syncClients).length) {
        await _sb.from("clients").update(syncClients).eq("email", client.em).neq("id", client.id);
      }
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
        await _sb.from("fidelite_client").update({ points: client.fid }).eq("id", fr.data[0].id);
      }
    } catch(e) { console.log("[FIDELITE SYNC]", e.message); }
  }
  // WAL : marquer la sauvegarde comme synchronisée si on est arrivé ici sans throw
  _walMarkSynced(_walId);
}

// Sauvegarder un rendez-vous/ticket
async function saveAppointment(appt) {
  if (!_isOnline || !_salonId) return;
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
        var _prevBypass = window._walBypass; window._walBypass = true;
        try { await saveAppointment(_apClone); } finally { window._walBypass = _prevBypass; }
      } catch (eDone) { console.warn("[saveAppointment online->done] persist appointment skipped:", eDone && eDone.message); }
      // Marque la rdv_online encaissee (compte client : RDV passe + facture ; dedup planning)
      try { _sb.from("rdv_online").update({ status: "done", ticket_num: (appt.tkNum || null) }).eq("id", onlineUuid).eq("salon_id", _salonId).then(function(){}, function(){}); } catch (e3) {}
      _walMarkSynced(_walId);
      return;
    }
    var onlineData = {
      collaborateur_id: appt.stId,
      date_rdv: appt.date,
      heure_rdv: appt.time,
      service_id: appt.sId,
      service_prix: appt.pr,
      message: appt.comment || "",
      items: appt.items || []
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
    // Reset la demande de modif client (puisque le salon vient de modifier de son côté)
    onlineData.modification_demandee = false;
    onlineData.modification_status = null;
    // Tracking de la modif salon : on lit l'état actuel pour calculer le diff
    try {
      var oldRes = await _sb.from("rdv_online").select("date_rdv,heure_rdv,collaborateur_id,collaborateur_nom,duree_minutes,service_id,service_nom,service_prix,items").eq("id", onlineUuid).eq("salon_id", _salonId).maybeSingle();
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
        if (Object.keys(diff).length > 0) {
          onlineData.salon_modified_at = new Date().toISOString();
          onlineData.salon_modified_fields = diff;
          onlineData.salon_modified_acknowledged_by_client = false;
          onlineData.salon_modified_acknowledged_at = null;
        }
      }
    } catch (eDiff) { console.warn("[saveAppointment online] diff calc skipped:", eDiff && eDiff.message); }
    try {
      var r = await _sb.from("rdv_online").update(onlineData).eq("id", onlineUuid).eq("salon_id", _salonId);
      if (r && r.error) console.warn("[saveAppointment online] update rdv_online failed:", r.error.message);
      else console.log("[saveAppointment online] rdv_online updated:", onlineUuid, onlineData.salon_modified_fields ? "(modif tracked)" : "(no diff)");
    } catch (e) { console.error("[saveAppointment online] exception:", e); }
    return;
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
    items: appt.items || [], comment: appt.comment || "",
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

  _ensureUuidId(appt);
  data.id = appt.id;
  var r = await _sb.from("appointments").upsert(data).select();
  if (r.error) {
    console.warn("saveAppointment upsert error, retry stripped:", r.error?.message);
    delete data.clients; delete data.from_caisse; delete data.client_email; delete data.collab_name;
    r = await _sb.from("appointments").upsert(data).select();
    if (r.error) {
      console.error("saveAppointment retry failed:", r.error);
      // FIX 2026-05-15 : log DB_ERROR pour monitoring admin
      try {
        if (typeof saveAuditEntry === "function") {
          saveAuditEntry("DB_ERROR", JSON.stringify({
            fn:"saveAppointment",
            msg: r.error.message || String(r.error),
            code: r.error.code || null,
            appt_id: appt.id || null,
            status: appt.st || null
          }).slice(0,2000));
        }
      } catch(_){}
      return;
    }
  }
  _walMarkSynced(_walId);
}

// Supprimer un RDV non-encaissé de la base
async function deleteAppointmentFromDb(apptId) {
  if (!_isOnline || !_salonId || !apptId) return;
  try {
    if (apptId.indexOf("-") > 0 && apptId.length > 30) {
      var r = await _sb.from("appointments").delete().eq("id", apptId).eq("salon_id", _salonId);
      if (r.error) console.error("[DEL APPT] Erreur:", r.error.message);
      else console.log("[DEL APPT] OK", apptId);
    }
  } catch(e) { console.error("[DEL APPT] Exception:", e.message); }
}

// Sauvegarder un produit
async function saveProduct(prod) {
  if (!_isOnline || !_salonId) return;
  var data = {
    salon_id: _salonId,
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
    coef_multi: prod.coefMulti || null,
    tva_taux: prod.tvaTaux || null,
    promo_actif: prod.promoActif || false,
    promo_prix: prod.promoPrix || null,
    promo_debut: prod.promoDebut || null,
    promo_fin: prod.promoFin || null,
    promo_label: prod.promoLabel || null,
    description: prod.description || null
  };
  if (typeof prod.id === "number" && prod.id > 0) {
    // Check if exists in Supabase
    var check = await _sb.from("produits").select("id").eq("id", prod.id).eq("salon_id", _salonId);
    if (check.data && check.data.length > 0) {
      await _sb.from("produits").update(data).eq("id", prod.id);
    } else {
      var res = await _sb.from("produits").insert(data).select();
      if (res.data && res.data[0]) prod.id = res.data[0].id;
    }
  } else {
    var res = await _sb.from("produits").insert(data).select();
    if (res.data && res.data[0]) prod.id = res.data[0].id;
  }
}

// Sauvegarder une carte cadeau
async function saveGiftCard(gc) {
  if (!_isOnline || !_salonId) return;
  var data = {
    salon_id: _salonId,
    valeur: gc.val, de: gc.from, pour: gc.to, message: gc.msg,
    code: gc.code, date_creation: gc.cr, date_expiration: gc.exp,
    utilise: gc.used, restant: gc.rem, status: gc.st,
    scope: gc.scope || "tout",
    gc_num: gc.gcNum || null,
    pay_method: gc.payMethod || null,
    is_offert: gc.isOffert || false,
    ht: gc.ht || 0,
    tva: gc.tva || 0,
    tva_rate: gc.tvaRate || 0.20,
    history: gc.history || [],
    tk_num: gc.tkNum || null
  };
  // FIX 2026-05-12 : upsert avec id explicite (U() génère UUID stable)
  _ensureUuidId(gc);
  data.id = gc.id;
  var res = await _sb.from("cartes_cadeaux").upsert(data).select();
  if (res.error) console.error("saveGiftCard upsert error:", res.error);
}

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
  // WAL : persiste le ticket en LS AVANT tout traitement (filet 15/05/2026)
  var _walId = window._walBypass ? null : _walPersist("ticket", tk);
  try {
    var pay = _mapPayment(tk);
    var dateStr = tk.date || new Date().toISOString().slice(0,10);
    var timeStr = tk.heureEncaiss || tk.time || new Date().toTimeString().slice(0,5);
    if (timeStr.length === 5) timeStr = timeStr + ":00"; // HH:MM → HH:MM:SS

    // Calcul TVA à partir du taux salon
    var taux = Number(SALON_CONFIG.tauxTVA || 20);
    var ttc = Number(tk.pr || 0);
    var ht, tva;
    // Double taux (ex. Luxembourg : prestations 8% / produits 17%). Garde-fou :
    // si taux produits == taux services (France, Belgique, défaut) -> calcul mono-taux
    // STRICTEMENT inchangé (byte-identique). Sinon -> ventilation prestations/produits.
    var _txProd = (SALON_CONFIG.tvaProduits != null && Number(SALON_CONFIG.tvaProduits) !== taux) ? Number(SALON_CONFIG.tvaProduits) : taux;
    if (_txProd === taux) {
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

    var data = {
      salon_id: _salonId,
      // num : laisser le trigger auto-calculer
      date_ticket: dateStr,
      heure_ticket: timeStr,
      client_id: (typeof tk.cId === "string" && tk.cId.length === 36) ? tk.cId : null,
      client_nom: tk.clientNom || null,
      client_prenom: tk.clientPrenom || null,
      collaborateur_id: tk.stId || null,
      collaborateur_nom: tk.stNom || null,
      items: tk.items || [],
      total_brut: Number(tk.brutTotal || tk.pr || 0),
      total_remise: Number(tk.remise || 0),
      total_ttc: ttc,
      total_ht: ht,
      total_tva: tva,
      taux_tva: taux,
      mode_paiement: pay.mode,
      detail_paiement: pay.detail,
      status: tk.cancelled ? "cancelled" : "paid",
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
    if (tk.hash && typeof tk.hash === "string" && tk.hash.length >= 16) {
      try {
        var existingCheck = await _sb.from("tickets")
          .select("id, num, hash, hash_prev")
          .eq("salon_id", _salonId)
          .eq("hash", tk.hash)
          .limit(1).maybeSingle();
        if (existingCheck.data && existingCheck.data.id) {
          console.log("[saveTicketToDb] Idempotence : ticket déjà en DB (hash match), skip insert. num=" + existingCheck.data.num);
          tk.dbId = existingCheck.data.id;
          if (!tk.tkNum) tk.tkNum = existingCheck.data.num;
          tk.hashPrev = existingCheck.data.hash_prev;
          _walMarkSynced(_walId);
          return existingCheck.data;
        }
      } catch (eIdem) {
        // Si le check plante, on continue normalement (best-effort)
        console.warn("[saveTicketToDb] idempotence check failed, fallback to INSERT:", eIdem?.message);
      }
    }

    var res = await _sb.from("tickets").insert(data).select().single();
    if (res.error) {
      console.warn("[saveTicketToDb] insert error", res.error);
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
      // WAL non marqué synced → récupération au prochain boot via popup
      return null;
    }
    // Mettre à jour l'objet local avec le num généré par le trigger + l'id + le hash
    if (res.data) {
      tk.dbId = res.data.id;
      if (!tk.tkNum) tk.tkNum = res.data.num;
      tk.hash = res.data.hash;
      tk.hashPrev = res.data.hash_prev;
    }
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

// Marque un ticket comme annulé (status=cancelled) — alternative au DELETE interdit
async function cancelTicketDb(ticketDbId, reason) {
  if (!_isOnline || !ticketDbId) return;
  try {
    await _sb.from("tickets")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: reason || null })
      .eq("id", ticketDbId);
  } catch (e) { console.warn("[cancelTicketDb]", e); }
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
    var taux = Number(SALON_CONFIG.tauxTVA || 20);
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
      if (upd.error) { console.warn("[saveDevisToDb] update error", upd.error); return null; }
      return upd.data;
    } else {
      var ins = await _sb.from("devis").insert(data).select().single();
      if (ins.error) { console.warn("[saveDevisToDb] insert error", ins.error); return null; }
      if (ins.data) {
        dv.dbId = ins.data.id;
        if (!dv.num) dv.num = ins.data.num;
        dv.dateValidite = ins.data.date_validite;
      }
      return ins.data;
    }
  } catch (e) {
    console.error("[saveDevisToDb] unexpected", e);
    return null;
  }
}

async function updateDevisStatus(devisDbId, newStatus, ticketDbId) {
  if (!_isOnline || !devisDbId) return;
  try {
    var patch = { status: newStatus };
    if (ticketDbId) patch.ticket_id = ticketDbId;
    await _sb.from("devis").update(patch).eq("id", devisDbId);
  } catch (e) { console.warn("[updateDevisStatus]", e); }
}

async function deleteDevisDb(devisDbId) {
  if (!_isOnline || !devisDbId) return;
  try {
    await _sb.from("devis").delete().eq("id", devisDbId);
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
    if (res.error) { console.warn("[savePendingTkDb]", res.error); return null; }
    if (res.data) pk.dbId = res.data.id;
    return res.data;
  } catch (e) { console.error("[savePendingTkDb]", e); return null; }
}

async function deletePendingTkDb(pkDbId) {
  if (!_isOnline || !pkDbId) return;
  try {
    await _sb.from("tickets_attente").delete().eq("id", pkDbId);
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
  await _sb.from("rdv_online").update(data).eq("id", rdvId);
}

// Sauvegarder une clôture Z (persistance NF525 + raw_data pour réimpression fidèle)
async function saveCloture(clot) {
  if (!_isOnline || !_salonId) return;
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
  var data = {
    salon_id: _salonId,
    date_cloture: clot.date, num: clot.num,
    total_ca: clot.totalCA, total_ht: clot.totalHT,
    nb_tickets: clot.nbTickets, nb_annulations: clot.nbAnnul,
    detail_paiements: _detailPaiements, detail_collabs: clot.perSty || {},
    cumul_mois_ca: clot.cumulMois || clot.cumulMoisCA || 0, cumul_mois_tickets: clot.cumulMoisTk || 0,
    cumul_annee_ca: clot.cumulAnnuel || clot.cumulAnCA || 0, cumul_annee_tickets: clot.cumulAnTk || 0,
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
  if (res.error) {
    if (res.error.code === "23505" || (res.error.message || "").indexOf("clotures_unique_num_per_salon") >= 0) {
      console.warn("[saveCloture] Doublon détecté (UNIQUE constraint), clôture déjà enregistrée. Num=" + clot.num);
      try {
        var existing = await _sb.from("clotures").select("id").eq("salon_id", _salonId).eq("num", clot.num).maybeSingle();
        if (existing.data && existing.data.id) clot.id = existing.data.id;
      } catch (_e) {}
      if (typeof toast === "function") toast("⚠️ Clôture déjà enregistrée — pas de doublon créé.", "info");
      _walMarkSynced(_walId);  // déjà existante = équivalent synchronisé
      return;
    }
    // FIX 2026-05-15 (soir) : code 42501 = RLS UPDATE block, normal pour clotures.
    // La table clotures est immuable par design NF525 (BOI-CF-COM-10-80-30-10) :
    // policies INSERT + SELECT uniquement, pas d'UPDATE/DELETE. Un upsert qui
    // tape sur une ligne existante (id déjà présent) déclenche ce code.
    // → On traite comme un succès : la clôture est déjà en DB et NF525-conforme.
    if (res.error.code === "42501" || (res.error.message || "").indexOf("row-level security") >= 0) {
      console.warn("[saveCloture] Clôture immutable (RLS UPDATE block) — déjà enregistrée. Num=" + clot.num);
      _walMarkSynced(_walId);
      return;
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
    return;
  }
  _walMarkSynced(_walId);
}

// Sauvegarder une entrée d'audit
async function saveAuditEntry(action, detail) {
  if (!_isOnline || !_salonId) {
    console.warn("[AUDIT] saveAuditEntry skipped: _isOnline="+_isOnline+" _salonId="+_salonId);
    return;
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
        } else {
          console.warn("[AUDIT] Insert réussi sans operator_id (colonnes peut-être manquantes)");
        }
      }
    } else {
      console.log("[AUDIT] Insert OK:", action);
    }
  } catch(e) {
    console.error("[AUDIT] Exception saveAuditEntry:", e.message || e);
  }
}

// Sauvegarder la config du salon
async function saveSalonConfig() {
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
      // écrasait silencieusement "Chaque cliente, une création unique" dans
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
      categories_services:(window.CATS_SVC&&Array.isArray(window.CATS_SVC))?window.CATS_SVC.slice():[],
      categories_forfaits:(window.CATS_FORF&&Array.isArray(window.CATS_FORF))?window.CATS_FORF.slice():[],
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
  var r=await _sb.from("salons").update(data).eq("id", _salonId);
  if(r&&r.error){delete data.config_json;await _sb.from("salons").update(data).eq("id", _salonId);}
}

// Supprime un service en DB. Vérifie le NOMBRE DE ROWS supprimées —
// car Supabase retourne 0 rows sans erreur si RLS bloque silencieusement.
async function deleteServiceDb(id) {
  if (!_sb || !_salonId || !id) return false;
  try {
    var r = await _sb.from("services").delete().eq("id", id).eq("salon_id", _salonId).select();
    if (r && r.error) { console.warn("[deleteServiceDb] error", r.error); return false; }
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
    if (r && r.error) { console.warn("[deleteServicesDbBulk] error", r.error); return false; }
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
async function saveServices() {
  if (!_sb || !_salonId) return;
  for (var i = 0; i < SVC.length; i++) {
    var s = SVC[i];
    var data = {
      salon_id: _salonId, nom: s.n, prix: s.p,
      categorie: s.cat, phases: s.phases || [],
      // FIX 2026-05-13 : cat_genre = tag H/F/E pour les stats genre précises au niveau item
      cat_genre: (s.catGenre === 'H' || s.catGenre === 'F' || s.catGenre === 'E') ? s.catGenre : null,
      show_site: s.showSite !== false, book_online: s.bookOnline !== false
    };
    if (typeof s.id === "number" && s.id > 0) {
      var check = await _sb.from("services").select("id").eq("id", s.id).eq("salon_id", _salonId);
      if (check.data && check.data.length > 0) {
        await _sb.from("services").update(data).eq("id", s.id);
      } else {
        var res = await _sb.from("services").insert(data).select();
        if (res.data && res.data[0]) s.id = res.data[0].id;
      }
    } else {
      var res = await _sb.from("services").insert(data).select();
      if (res.data && res.data[0]) s.id = res.data[0].id;
    }
  }
}

// Sauvegarder les forfaits
async function saveForfaits() {
  if (!_sb || !_salonId) return;
  for (var i = 0; i < FORFAITS.length; i++) {
    var f = FORFAITS[i];
    var data = {
      salon_id: _salonId, nom: f.n, prix: f.p,
      categorie: f.cat, services: f.services || [],
      phases: f.phases || [],
      // FIX 2026-05-13 : cat_genre pour stats (H/F/E) — utile aux forfaits enfant (ado, junior)
      cat_genre: (f.catGenre === 'H' || f.catGenre === 'F' || f.catGenre === 'E') ? f.catGenre : null,
      show_site: f.showSite !== false, book_online: f.bookOnline !== false
    };
    if (typeof f.id === "number" && f.id > 0) {
      var check = await _sb.from("forfaits").select("id").eq("id", f.id).eq("salon_id", _salonId);
      if (check.data && check.data.length > 0) {
        await _sb.from("forfaits").update(data).eq("id", f.id);
      } else {
        var res = await _sb.from("forfaits").insert(data).select();
        if (res.data && res.data[0]) f.id = res.data[0].id;
      }
    } else {
      var res = await _sb.from("forfaits").insert(data).select();
      if (res.data && res.data[0]) f.id = res.data[0].id;
    }
  }
  // Also save to localStorage as backup
  try { localStorage.setItem("_cp_forfaits", JSON.stringify(FORFAITS)); } catch(e) {}
}

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
  if (res.error) console.error("savePack upsert error:", res.error);
}

// Valider une séance d'un pack
async function usePackSeance(packId) {
  if (!_sb) return;
  var pk = (window.PACKS_CLIENTS || []).find(function(p) { return p.id === packId; });
  if (!pk) return;
  pk.used = (pk.used || 0) + 1;
  if (pk.used >= pk.total) pk.status = "completed";
  await _sb.from("packs_clients").update({ seances_utilisees: pk.used, status: pk.status }).eq("id", packId);
  return pk;
}

// Supprimer un forfait
async function deleteForfaitFromDb(forfaitId) {
  if (!_sb || !_salonId) return;
  await _sb.from("forfaits").delete().eq("id", forfaitId).eq("salon_id", _salonId);
}

async function saveCollaborateurs() {
  if (!_isOnline || !_salonId) return;
  // FIX 2026-05-11 (Manue photo perdue) : récupère img+id pour pouvoir
  // PRÉSERVER une photo DB existante si la mémoire locale a img="" (race
  // condition entre 2 sessions / reload partiel). La suppression explicite
  // passe par clearStyImg → clearCollabPhoto(id) qui force img="" directement.
  var existing = await _sb.from("collaborateurs").select("id,img,nom,initiales,couleur").eq("salon_id", _salonId);
  var dbIds = {};
  var dbImg = {};
  // FIX 2026-06-19 : signature nom|initiales|couleur -> id existant. Permet d'ADOPTER
  // une ligne déjà en base au lieu d'INSÉRER un clone quand l'id en mémoire ne matche
  // pas (état transitoire au démarrage : T hydraté depuis le cache avant le load DB,
  // puis save déclenché par une navigation). Évite la duplication des collaborateurs.
  var dbBySig = {};
  if (existing.data) {
    for (var e = 0; e < existing.data.length; e++) {
      var ex = existing.data[e];
      dbIds[ex.id] = true;
      dbImg[ex.id] = ex.img || "";
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
      horaires_overrides: c.hrsOver || {},
      date_entree: c.dateEntree || null,
      date_depart: c.dateDepart || null,
      inactif: c.inactif === true,
      photo_visible: c.photoVisible !== false,
      competences: c.competences || {all:true}
    };
    if (c.id && dbIds[c.id]) {
      // Exists in DB → UPDATE
      await _sb.from("collaborateurs").update(data).eq("id", c.id);
    } else {
      // FIX 2026-06-19 : avant d'insérer, on cherche un collaborateur identique déjà
      // en base (même nom + initiales + couleur). S'il existe, on l'ADOPTE (UPDATE +
      // récupération de son id) au lieu de créer un doublon. Sinon -> vrai nouveau -> INSERT.
      var _sig = (c.n||"")+"|"+(c.i||"")+"|"+(c.c||"");
      if (dbBySig[_sig] !== undefined) {
        c.id = dbBySig[_sig];
        await _sb.from("collaborateurs").update(data).eq("id", c.id);
      } else {
        var res = await _sb.from("collaborateurs").insert(data).select();
        if (res.data && res.data[0]) { c.id = res.data[0].id; dbIds[c.id] = true; dbBySig[_sig] = c.id; }
      }
    }
  }
}

// Effacement explicite de la photo d'un collaborateur (utilisé par clearStyImg)
// Bypass la protection anti-écrasement de saveCollaborateurs().
async function clearCollabPhoto(collabId) {
  if (!_isOnline || !_salonId || !collabId) return;
  await _sb.from("collaborateurs").update({ img: "" }).eq("id", collabId);
}

// FIX 2026-05-12 : update CIBLÉ d'un seul collab pour éviter le pattern
// "le bulk save de saveCollaborateurs écrase les autres collabs avec
// la mémoire locale stale". Quand l'utilisateur modifie un horaire/pause
// d'un seul collab, on ne touche QUE ce collab en DB.
async function saveCollabPartial(collabIdx, fields) {
  if (!_isOnline || !_salonId) return;
  if (typeof collabIdx !== "number" || !T[collabIdx]) return;
  var c = T[collabIdx];
  if (!c.id || typeof fields !== "object") return;
  try {
    await _sb.from("collaborateurs").update(fields).eq("id", c.id);
  } catch (e) { console.warn("saveCollabPartial:", e); }
}
window.saveCollabPartial = saveCollabPartial;

// Supprimer un client
async function deleteClient(clientId) {
  if (!_isOnline || !_salonId) return;
  await _sb.from("clients").delete().eq("id", clientId);
}

// Supprimer un produit
async function deleteProduct(productId) {
  if (!_isOnline || !_salonId) return;
  await _sb.from("produits").delete().eq("id", productId);
}

// Supprimer un bon cadeau
async function deleteGiftCard(gcId) {
  if (!_isOnline || !_salonId) return;
  await _sb.from("cartes_cadeaux").delete().eq("id", gcId);
  // Also remove from local array
  for (var i = 0; i < GC.length; i++) { if (GC[i].id === gcId) { GC.splice(i, 1); break; } }
}

// Purger TOUS les bons cadeaux du salon
async function purgeAllGiftCards() {
  if (!_isOnline || !_salonId) return;
  await _sb.from("cartes_cadeaux").delete().eq("salon_id", _salonId);
  GC.length = 0;
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
  if (res.error) console.error("saveFournisseur upsert error:", res.error);
}
async function deleteFournisseur(fId) {
  if (!_isOnline || !_salonId) return;
  // Unlink products first
  await _sb.from("produits").update({ fournisseur_id: null }).eq("fournisseur_id", fId).eq("salon_id", _salonId);
  await _sb.from("fournisseurs").delete().eq("id", fId).eq("salon_id", _salonId);
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
    await _sb.from("mouvements_stock").insert({
      salon_id: _salonId, produit_id: prodId, produit_nom: prodNom,
      type: type, quantite: qty, stock_avant: stkAvant, stock_apres: stkApres,
      reference: ref || null, note: note || null,
      motif: motif || null, motif_label: motifLabel || null,
      commentaire: note || null,
      operator_id: _opId, operator_name: _opName
    });
  } catch(e) { console.error("[MVT STOCK]", e.message); }
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

// Charger tous les opérateurs du salon
async function loadOperateurs() {
  if (!_isOnline || !_salonId) return [];
  try {
    var r = await _sb.from("salon_operateurs").select("*").eq("salon_id", _salonId).order("created_at");
    return r.data || [];
  } catch(e) { console.error("[OP LOAD]", e.message); return []; }
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
    var r = await _sb.from("salon_operateurs").insert(insert).select();
    if (r.error) throw r.error;
    return r.data && r.data[0] ? r.data[0] : null;
  } catch(e) { console.error("[OP CREATE]", e.message); return null; }
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
    var r = await _sb.from("salon_operateurs").update(update).eq("id", id);
    return !r.error;
  } catch(e) { console.error("[OP UPDATE]", e.message); return false; }
}

// Changer le PIN d'un opérateur
async function changeOperateurPIN(id, newPin) {
  if (!_isOnline || !_salonId) return false;
  try {
    var pinHash = await hashPIN(newPin, _salonId);
    var r = await _sb.from("salon_operateurs").update({
      pin_hash: pinHash,
      pin_length: newPin.length,
      failed_attempts: 0,
      locked_until: null
    }).eq("id", id);
    return !r.error;
  } catch(e) { console.error("[OP PIN]", e.message); return false; }
}

// Supprimer un opérateur
async function deleteOperateur(id) {
  if (!_isOnline || !_salonId) return false;
  try {
    var r = await _sb.from("salon_operateurs").delete().eq("id", id);
    return !r.error;
  } catch(e) { console.error("[OP DEL]", e.message); return false; }
}

// Tenter login avec PIN — retourne {ok:true, op:...} ou {ok:false, error:..., locked:bool}
async function operatorLogin(operatorId, pin) {
  if (!_isOnline || !_salonId) return {ok:false, error:"Hors ligne"};
  try {
    var r = await _sb.from("salon_operateurs").select("*").eq("id", operatorId).limit(1);
    if (!r.data || !r.data.length) return {ok:false, error:"Op\u00e9rateur introuvable"};
    var op = r.data[0];
    if (!op.actif) return {ok:false, error:"Compte d\u00e9sactiv\u00e9"};
    if (op.locked_until && new Date(op.locked_until) > new Date()) {
      return {ok:false, error:"Compte verrouill\u00e9 (trop d'erreurs)", locked:true, remaining:0, max:5, lockedUntil:op.locked_until};
    }
    var pinHash = await hashPIN(pin, _salonId);
    if (pinHash !== op.pin_hash) {
      // Increment failed attempts
      var fails = (op.failed_attempts || 0) + 1;
      var update = {failed_attempts: fails};
      if (fails >= 5) {
        // Lock for 30 minutes
        update.locked_until = new Date(Date.now() + 30*60*1000).toISOString();
      }
      await _sb.from("salon_operateurs").update(update).eq("id", operatorId);
      return {ok:false, error:"PIN incorrect ("+fails+"/5)", locked:fails>=5, fails:fails, remaining:Math.max(0,5-fails), max:5, lockedUntil:update.locked_until||null};
    }
    // Success
    await _sb.from("salon_operateurs").update({
      failed_attempts: 0,
      locked_until: null,
      last_login_at: new Date().toISOString()
    }).eq("id", operatorId);
    return {ok:true, op:op};
  } catch(e) { console.error("[OP LOGIN]", e.message); return {ok:false, error:e.message}; }
}

// Débloquer manuellement un opérateur (admin only)
async function unlockOperateur(id) {
  if (!_isOnline || !_salonId) return false;
  try {
    var r = await _sb.from("salon_operateurs").update({
      failed_attempts: 0,
      locked_until: null
    }).eq("id", id);
    return !r.error;
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
  if (existing) {
    // Link beautypro_id if not set
    if (bpId && !existing.client_luxyra_id) {
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
    sms_ok: true,
    email_ok: true,
    acquisition_source: "en_ligne",
    created_at: new Date().toISOString()
  };
  var res = await _sb.from("clients").insert(newClient).select();
  if (res.data && res.data[0]) return res.data[0].id;
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
      await _sb.from("fidelite_client").update(updateData).eq("id", f.id);
    } else {
      await _sb.from("fidelite_client").insert({
        client_luxyra_id: bpId,
        salon_id: salonId,
        salon_nom: salonNom || SALON_CONFIG.nom,
        points: pts !== null ? pts : 1,
        visites: countVisit ? 1 : 0,
        derniere_visite: new Date().toISOString().slice(0, 10),
        seuil_fidelite: fidconf.seuil || 10,
        remise_fidelite: fidconf.remise || 10,
        remise_type: fidconf.type || "amount"
      });
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
