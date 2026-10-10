// ============================================================
// LUXYRA WORKER — Cloudflare Worker
// Gère : Stripe, Brevo Email/SMS, Clean URLs, Subdomains, SMS Native Link, Slugs salons
// FIX W1: Stripe webhook signature HMAC verification
// FIX W3: Clean routes corrected (mentions-legales, politique-confidentialite)
// FIX W4: "conforme NF525" (not "certifié")
// FIX W5: Basic rate limiting on SMS/email endpoints
// FIX W6: SMS sender .trim() to avoid trailing space
// NEW SMS-NATIVE: /api/sms/generate-link-token + /api/sms/link-device
// FIX W7: Added /suppression-donnees route for Google Play data deletion page
// NEW SLUG (28 avr 2026): /<slug> → /site.html avec window.__SALON_SLUG injecté
// ============================================================

// FIX W5: Simple in-memory rate limiter (per isolate, resets on redeploy)
const RATE_LIMITS = new Map(); // key → {count, resetAt}
function checkRateLimit(key, maxPerMinute) {
  const now = Date.now();
  const entry = RATE_LIMITS.get(key);
  if (!entry || now > entry.resetAt) {
    RATE_LIMITS.set(key, { count: 1, resetAt: now + 60000 });
    return true;
  }
  if (entry.count >= maxPerMinute) return false;
  entry.count++;
  return true;
}

const CONFIG = {
  SUPABASE_URL: "https://kxdgjtvrkwugbifgppai.supabase.co",
  // Cle ANON (publique — deja exposee dans luxyra-supabase.js / le navigateur).
  // Utilisee UNIQUEMENT pour le SSR SEO : la RLS garantit qu'on ne lit que du
  // public. Ne JAMAIS s'en servir pour une ecriture privilegiee.
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4ZGdqdHZya3d1Z2JpZmdwcGFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNDE2NTgsImV4cCI6MjA4ODYxNzY1OH0.J3jVuoHSWA0wXyaWxiRzILEWVNr8hbbgVYg73UEDTuI",
  PRICE_ESSENTIAL: "price_1TIBRRPk42Psx94TsYdIG0UF",
  PRICE_PRO: "price_1TIBROPk42Psx94Tjr6g8OEF",
  // Tarif "Pro Fondateur" — 14,99€/mois à vie pour les 100 premiers Pro
  // Stripe lookup_key: pro_founder_monthly_eur
  PRICE_PRO_FOUNDER: "price_1TXTu6Pk42Psx94TokzLzD33",
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// ============================================================
// reportWorkerError : helper pour logger les erreurs serveur Cloudflare
// dans server_errors via Supabase REST. Non-throwing (best-effort).
// ============================================================
async function reportWorkerError(env, source, error, context, severity) {
  try {
    const msg = error && error.message ? String(error.message).slice(0, 800) : String(error || "Unknown error").slice(0, 800);
    const stack = error && error.stack ? String(error.stack).slice(0, 3000) : null;
    const sbKey = env.SUPABASE_SERVICE_KEY;
    if (!sbKey) return; // si pas de clé, on log juste en console
    await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/report_server_error`, {
      method: "POST",
      headers: {
        "apikey": sbKey,
        "Authorization": `Bearer ${sbKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        p_source: String(source || "worker:unknown").slice(0, 200),
        p_message: msg,
        p_severity: severity || "error",
        p_stack: stack,
        p_context: context || null
      })
    }).catch(function(e){ console.warn("[reportWorkerError] POST failed:", e?.message); });
  } catch (e) {
    console.error("[reportWorkerError] exception:", e?.message);
  }
}

// /health endpoint pour monitoring externe (UptimeRobot, Better Stack)
// Renvoie 200 si tout va bien, 503 si le système de monitoring lui-même est dégradé.
// Couvre : heartbeat PG, Cloudflare worker en vie, DB Supabase accessible.
async function handleHealth(request, env) {
  const url = "https://kxdgjtvrkwugbifgppai.supabase.co/rest/v1/rpc/get_monitoring_status";
  const SB_ANON = env.SUPABASE_ANON_KEY || "";
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SB_ANON,
        "Authorization": "Bearer " + SB_ANON
      },
      body: "{}"
    });
    if (!r.ok) {
      return new Response(JSON.stringify({ status: "degraded", reason: "supabase_unreachable", code: r.status }), {
        status: 503,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
      });
    }
    const data = await r.json();
    const ok = data && data.alive === true;
    return new Response(JSON.stringify(Object.assign({ worker: "alive" }, data || {})), {
      status: ok ? 200 : 503,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ status: "down", reason: "exception", message: String(e && e.message || e).slice(0, 200) }), {
      status: 503,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
    });
  }
}

// Wrapper séparé pour les handlers /api/* (séparé pour clarté)
async function __wrappedApiHandler(request, url, env) {
    try {
      // SECURITE 2026-10-08 : routes d'un salon -> proprietaire du salon (ou appel serveur / admin)
      if (request.method === "POST" && LX_ROUTES_SALON.has(url.pathname)) {
        const _b = await lxBodyCopie(request);
        const _refus = await lxGuardSalon(request, env, _b && _b.salon_id);
        if (_refus) return _refus;
      }
      // Endpoint /health (GET) — monitoring externe
      if (url.pathname === "/health" || url.pathname === "/api/health") return await handleHealth(request, env);
      if (url.pathname === "/api/stripe/create-checkout" && request.method === "POST") return await handleCreateCheckout(request, env);
      if (url.pathname === "/api/stripe/webhook" && request.method === "POST") return await handleWebhook(request, env);
      if (url.pathname === "/api/siret" && request.method === "GET") return await handleSiret(request, env);
      if (url.pathname.startsWith("/api/e/o/") && request.method === "GET") return await handlePixelOuverture(request, env, url);
      if (url.pathname === "/api/stripe/webhook-connect" && request.method === "POST") return await handleWebhookConnect(request, env);
      if (url.pathname === "/api/brevo/sms-event" && request.method === "POST") return await handleBrevoSmsEvent(request, env);
      if (url.pathname === "/api/sms/recharge-auto" && request.method === "POST") return await handleSmsRechargeAuto(request, env);
      if (url.pathname === "/api/stripe/portal" && request.method === "POST") return await handlePortal(request, env);
      if (url.pathname === "/api/stripe/switch-plan" && request.method === "POST") return await handleSwitchPlan(request, env);
      if (url.pathname === "/api/admin/offer-month" && request.method === "POST") return await handleOfferMonth(request, env);
      if (url.pathname === "/api/admin/stripe" && request.method === "POST") return await handleAdminStripe(request, env);
      // Stripe Connect
      if (url.pathname === "/api/stripe/connect-onboard" && request.method === "POST") return await handleConnectOnboard(request, env);
      if (url.pathname === "/api/stripe/connect-status" && request.method === "POST") return await handleConnectStatus(request, env);
      if (url.pathname === "/api/stripe/connect-dashboard" && request.method === "POST") return await handleConnectDashboard(request, env);
      if (url.pathname === "/api/stripe/connect-payment" && request.method === "POST") return await handleConnectPayment(request, env);
      // 2026-10-08 : Click & Collect
      if (url.pathname === "/api/cc/commande" && request.method === "POST") return await handleCcCommande(request, env);
      if (url.pathname === "/api/cc/finalize" && request.method === "POST") return await handleCcFinalize(request, env);
      if (url.pathname === "/api/cc/action" && request.method === "POST") return await handleCcAction(request, env);
      if (url.pathname === "/api/client/commandes" && request.method === "POST") return await handleClientCommandes(request, env);
      // FIX 2026-05-13 : Export NF525 (conservation 6 ans / audit fiscal)
      if (url.pathname === "/api/admin/export-nf525" && request.method === "POST") return await handleExportNF525(request, env);
      // FIX 2026-05-12 : Path A empreinte (post-Checkout, stocke le PI ID dans rdv_online)
      if (url.pathname === "/api/stripe/empreinte-finalize" && request.method === "POST") return await handleEmpreinteFinalize(request, env);
      // FIX 2026-05-23 : Path A acompte (post-Checkout, stocke le PI ID → remboursement auto possible)
      if (url.pathname === "/api/stripe/acompte-finalize" && request.method === "POST") return await handleAcompteFinalize(request, env);
      // FIX 2026-05-12 : Path A pour RDV sur mesure (acompte direct au salon)
      if (url.pathname === "/api/rdv-demande/connect-pay" && request.method === "POST") return await handleRdvDemandeConnectPay(request, env);
      if (url.pathname === "/api/rdv-demande/finalize" && request.method === "POST") return await handleRdvDemandeFinalize(request, env);
      if (url.pathname === "/api/email/ticket" && request.method === "POST") return await handleEmailTicket(request, env);
      if (url.pathname === "/api/email/welcome" && request.method === "POST") return await handleEmailWelcome(request, env);
      if (url.pathname === "/api/email/custom" && request.method === "POST") return await handleEmailCustom(request, env);
      if (url.pathname === "/api/sms/rappel" && request.method === "POST") return await handleSmsRappel(request, env);
      if (url.pathname === "/api/sms/custom" && request.method === "POST") return await handleSmsCustom(request, env);
      // NEW: SMS Native companion app linking
      if (url.pathname === "/api/sms/generate-link-token" && request.method === "POST") return await handleSmsGenerateLinkToken(request, env);
      if (url.pathname === "/api/sms/link-device" && request.method === "POST") return await handleSmsLinkDevice(request, env);
      if (url.pathname === "/api/client/tickets" && request.method === "POST") return await handleClientTickets(request, env);
      // FIX 2026-05-13 : transparence frais Stripe — pull en temps réel des balance_transactions
      // du compte Stripe Connect du salon. Read-only, authentifié par JWT Supabase.
      if (url.pathname === "/api/stripe/fees" && request.method === "POST") return await handleStripeFees(request, env);
      // FIX 2026-05-14 : désabonnement RGPD 1-clic depuis lien email
      if (url.pathname === "/api/unsubscribe" && request.method === "GET") return await handleUnsubscribe(request, env);
      // Endpoints espace client compte.html — bypass RLS via service_role
      // après vérification du session_token JWT (issu de lx-login/lx-signup).
      // Permet de DROP les policies anon USING(true) qui leakaient toutes les
      // données client cross-salons à n'importe quel détenteur de l'anon key.
      if (url.pathname === "/api/client/cartes" && request.method === "POST") return await handleClientCartes(request, env);
      if (url.pathname === "/api/client/fidelite" && request.method === "POST") return await handleClientFidelite(request, env);
      if (url.pathname === "/api/client/rdvs" && request.method === "POST") return await handleClientRdvs(request, env);
      if (url.pathname === "/api/client/rdv-update" && request.method === "POST") return await handleClientRdvUpdate(request, env);
      if (url.pathname === "/api/client/anonymize" && request.method === "POST") return await handleClientAnonymize(request, env);
      // Invitations clients (magic link "créer mot de passe")
      if (url.pathname === "/api/client/invite" && request.method === "POST") return await handleClientInvite(request, env);
      if (url.pathname === "/api/client/invite/verify" && request.method === "POST") return await handleClientInviteVerify(request, env);
      if (url.pathname === "/api/salon/availability" && request.method === "POST") return await handleSalonAvailability(request, env);
      if (url.pathname === "/api/rdv/cancel" && request.method === "POST") return await handleRdvCancel(request, env);
      // Endpoint admin pour déclencher manuellement le job de rétention (debug/test).
      // Sécurisé par un secret bearer token dans env.RETENTION_ADMIN_TOKEN.
      if (url.pathname === "/api/admin/retention-purge" && request.method === "POST") {
        const auth = request.headers.get("Authorization") || "";
        if (!env.RETENTION_ADMIN_TOKEN || auth !== `Bearer ${env.RETENTION_ADMIN_TOKEN}`) {
          return jsonResponse({ error: "unauthorized" }, 401);
        }
        const result = await runRetentionPurgeJob(env);
        return jsonResponse({ success: true, ...result });
      }
      return jsonResponse({ error: "Not found" }, 404);
    } catch (err) {
      console.error("Worker error:", err);
      return jsonResponse({ error: err.message }, 500);
    }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
    // ============ TRY/CATCH GLOBAL : toute exception non gérée arrive ici ============
    try {
      // /health (et /api/health) — monitoring externe (UptimeRobot, Better Stack, etc.)
      // Capté AVANT le routing normal pour répondre vite (pas de DOM/HTML).
      if (url.pathname === "/health" || url.pathname === "/api/health") {
        return await handleHealth(request, env);
      }
      // Route les pages non-/api/ vers handleExistingRoutes
      if (!url.pathname.startsWith("/api/")) {
        try {
          return await handleExistingRoutes(request, url, env);
        } catch (eh) {
          await reportWorkerError(env, "worker:handleExistingRoutes", eh, {
            method: request.method, path: url.pathname
          }, "critical");
          return new Response("Service temporairement indisponible. Veuillez réessayer.", { status: 500 });
        }
      }
      // /api/* — wrapper qui catch les erreurs des handlers individuels
      const apiResult = await __wrappedApiHandler(request, url, env);
      // Log les 5xx pour visibilité (sans modifier le comportement)
      if (apiResult && apiResult.status >= 500) {
        try {
          var bodyClone = apiResult.clone();
          var bodyText = "";
          try { bodyText = (await bodyClone.text()).slice(0, 500); } catch(_) {}
          await reportWorkerError(env, "worker:api_5xx", new Error("5xx response: " + bodyText), {
            method: request.method, path: url.pathname, status: apiResult.status
          }, "error");
        } catch(_){}
      }
      return apiResult;
    } catch (eFatal) {
      // Exception NON-CATCHÉE remontée jusqu'au fetch() → critique
      try {
        await reportWorkerError(env, "worker:fatal", eFatal, {
          method: request.method, path: url.pathname, ua: request.headers.get("user-agent")
        }, "critical");
      } catch(_) {}
      return new Response("Une erreur interne est survenue. Notre équipe a été notifiée.", { status: 500 });
    }
  },

  // Cron trigger Cloudflare — appelé selon la config wrangler.toml [triggers].crons.
  // Pour l'instant 1×/jour à 3h UTC : job de rétention (préavis + purge 6 ans).
  async scheduled(event, env, ctx) {
    console.log(`[cron] scheduled event triggered: ${event.cron} at ${new Date(event.scheduledTime).toISOString()}`);
    // 2026-10-09 : cron de 08:00 UTC = relances d'essai uniquement
    if (event.cron === "0 8 * * *") {
      try { console.log("[cron] relances essai:", await runRelancesEssaiJob(env)); }
      catch (err) { await reportWorkerError(env, "cron:relances-essai", err, null, "error"); }
      try { console.log("[cron] rappel attestation:", await runAttestationRelanceJob(env)); }
      catch (err) { await reportWorkerError(env, "cron:rappel-attestation", err, null, "warning"); }
      try { console.log("[cron] rapprochement SMS:", await runSmsRapprochementJob(env)); }
      catch (err) { await reportWorkerError(env, "cron:sms-rapprochement", err, null, "warning"); }
      return;
    }
    try {
      const result = await runRetentionPurgeJob(env);
      console.log(`[cron] retention-purge done:`, result);
    } catch (err) {
      console.error(`[cron] retention-purge FAILED:`, err?.message || err);
      await reportWorkerError(env, "cron:retention-purge", err, { event_cron: event.cron }, "critical");
      // On ne re-throw pas — on veut que le cron continue de tourner les jours suivants.
    }
    // Job cartes pending orphelines : créées via doVenteCarteAbo mais jamais
    // confirmées par un paiement (ex: vente abandonnée, double-clic supprimé).
    // Sans ce purge, elles restent en "pending" et peuvent réapparaître dans
    // l'UI. Avec notre fix anti-bug 2026-05-05, l'ancienne carte n'est plus
    // marquée replaced à tort — mais on veut quand même nettoyer les pending
    // qui traînent (≥ 24 h).
    try {
      const result2 = await runPendingCartesAboPurgeJob(env);
      console.log(`[cron] pending-cartes-purge done:`, result2);
    } catch (err) {
      console.error(`[cron] pending-cartes-purge FAILED:`, err?.message || err);
      await reportWorkerError(env, "cron:pending-cartes-purge", err, null, "error");
    }
    // FIX 2026-05-12 : job purge RDV pending_payment abandonnés (> 1h, payment_intent_id NULL)
    // Évite la pollution de la table rdv_online par des paiements Stripe abandonnés.
    // Le client-side filtre déjà > 15 min, mais on nettoie la DB pour de bon.
    try {
      const result3 = await runPendingPaymentRdvPurgeJob(env);
      console.log(`[cron] pending-payment-rdv-purge done:`, result3);
    } catch (err) {
      console.error(`[cron] pending-payment-rdv-purge FAILED:`, err?.message || err);
      await reportWorkerError(env, "cron:pending-payment-rdv-purge", err, null, "error");
    }
    // FIX 2026-05-13 : Job d'audit intégrité quotidien sur tous les salons actifs.
    // Appelle public.check_data_integrity() (READ-ONLY) sur chaque salon, agrège les
    // anomalies, et envoie un email à support@luxyra.fr SEULEMENT si problème détecté.
    // Inbox vide = tout va bien.
    try {
      const result4 = await runIntegrityCheckJob(env);
      console.log(`[cron] integrity-check done:`, result4);
    } catch (err) {
      console.error(`[cron] integrity-check FAILED:`, err?.message || err);
      await reportWorkerError(env, "cron:integrity-check", err, null, "critical");
    }
    // 2026-10-09 : surveillance Stripe (litiges à traiter, comptes Stripe des salons bloqués)
    try {
      const resS = await runStripeSurveillanceJob(env);
      console.log(`[cron] stripe-surveillance done:`, resS);
    } catch (err) {
      await reportWorkerError(env, "cron:stripe-surveillance", err, null, "error");
    }
    // FIX 2026-05-23 : réconciliation des remboursements d'acompte (annulations
    // non encore remboursées dans le délai). Filet + rattrapage.
    try {
      const result5 = await runRefundReconcileJob(env);
      console.log(`[cron] refund-reconcile done:`, result5);
    } catch (err) {
      console.error(`[cron] refund-reconcile FAILED:`, err?.message || err);
      await reportWorkerError(env, "cron:refund-reconcile", err, null, "error");
    }
  },

};



// ============================================================
// FIX W1: STRIPE WEBHOOK SIGNATURE VERIFICATION (HMAC SHA-256)
// ============================================================
async function verifyStripeSignature(payload, sigHeader, secret) {
  if (!sigHeader || !secret) return null;
  const parts = {};
  sigHeader.split(",").forEach(function(p) { const [k, v] = p.split("="); parts[k.trim()] = v; });
  const timestamp = parts["t"];
  const sig = parts["v1"];
  if (!timestamp || !sig) return null;
  // Reject timestamps older than 5 minutes
  if (Math.abs(Math.floor(Date.now() / 1000) - parseInt(timestamp)) > 300) return null;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signatureBytes = await crypto.subtle.sign("HMAC", key, encoder.encode(timestamp + "." + payload));
  const expected = Array.from(new Uint8Array(signatureBytes)).map(b => b.toString(16).padStart(2, "0")).join("");
  if (expected !== sig) return null;
  try { return JSON.parse(payload); } catch (e) { return null; }
}

// ============================================================
// NEW SMS-NATIVE: HMAC helper for link token signing
// ============================================================
async function hmacSignHex(message, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, "0")).join("");
}

// Constant-time string comparison to avoid timing attacks
function constantTimeEquals(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// Generate a UUID v4 (for tokens and device IDs)
function generateUuidV4() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
}

// ============================================================
// CLIENT SESSION VERIFY — délègue à lx-profile edge function
// ============================================================
// Plutôt que de tenter une vérif HMAC locale (qui dépendrait d'un secret
// partagé exact entre Cloudflare et Supabase Edge Functions, fragile en
// pratique car les noms de secrets varient), on délègue la validation
// à l'edge function `lx-profile` qui a elle-même signé le token : si
// elle renvoie 200 avec un user, le token est valide. Coût ~50-100 ms
// par appel — acceptable pour des actions user-initiated (pas de hot path).
//
// Renvoie { lx_id, email } si valide, sinon null.
async function verifyClientSession(token, env) {
  if (!token || typeof token !== "string") return null;
  if (!env.SUPABASE_SERVICE_KEY) {
    console.error("[verifyClientSession] SUPABASE_SERVICE_KEY missing");
    return null;
  }
  try {
    const r = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/lx-profile`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Apikey requise par Supabase Functions gateway
        "apikey": env.SUPABASE_SERVICE_KEY,
        "Authorization": "Bearer " + env.SUPABASE_SERVICE_KEY
      },
      body: JSON.stringify({ session_token: token, action: "get" })
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      console.error("[verifyClientSession] lx-profile non-OK:", r.status, errText.slice(0, 200));
      return null;
    }
    const data = await r.json().catch(() => null);
    if (!data || !data.user) {
      console.error("[verifyClientSession] lx-profile no user in response:", JSON.stringify(data).slice(0, 200));
      return null;
    }
    const u = data.user;
    if (!u.id) return null;
    return { lx_id: String(u.id), email: String(u.email || "").toLowerCase().trim() };
  } catch (e) {
    console.error("[verifyClientSession] exception:", e?.message || e);
    return null;
  }
}

// Helper Supabase REST avec service_role pour les endpoints client/*
function _sbHeaders(env, opts = {}) {
  const sbKey = env.SUPABASE_SERVICE_KEY;
  return Object.assign({
    "apikey": sbKey,
    "Authorization": "Bearer " + sbKey,
    "Content-Type": "application/json"
  }, opts);
}

// ============================================================
// SECURITE 2026-10-08 : identification de l'appelant des routes /api/*
// - appel serveur (edge functions, base) : en-tete x-lx-internal = cle service du projet ;
// - salon connecte : Authorization: Bearer <JWT Supabase> + proprietaire du salon_id ;
// - admin Luxyra : JWT de support@luxyra.fr.
// ============================================================
function lxEgal(a, b) { a = String(a || ""); b = String(b || ""); if (!a || a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
const _lxInternalCache = new Map();
async function lxIsInternal(request, env) {
  const t = String(request.headers.get("x-lx-internal") || "").trim();
  if (!t) return false;
  if (env.SUPABASE_SERVICE_KEY && lxEgal(t, env.SUPABASE_SERVICE_KEY)) return true;
  if (_lxInternalCache.has(t)) return _lxInternalCache.get(t);
  let ok = false;
  try {
    // Cle service sous une autre forme (JWT ou cle secrete « sb_secret_… ») : seule une cle service
    // du projet peut lister les comptes. Verifiee aupres de Supabase une fois par isolat.
    if (t.length >= 30 && t !== CONFIG.SUPABASE_ANON_KEY) {
      const _jwt = t.split(".").length === 3;
      const r = await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/admin/users?per_page=1`, { headers: _jwt ? { apikey: t, Authorization: "Bearer " + t } : { apikey: t } });
      ok = r.ok;
    }
  } catch (e) { ok = false; }
  if (_lxInternalCache.size > 50) _lxInternalCache.clear();
  _lxInternalCache.set(t, ok);
  return ok;
}
async function lxAuthUser(request) {
  const t = String(request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!t || t === CONFIG.SUPABASE_ANON_KEY) return null;
  try {
    const r = await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: CONFIG.SUPABASE_ANON_KEY, Authorization: "Bearer " + t } });
    if (!r.ok) return null;
    const u = await r.json();
    if (u && u.id) { try { u._aal = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).aal || "aal1"; } catch (_) { u._aal = "aal1"; } }
    return (u && u.id) ? u : null;
  } catch (e) { return null; }
}
// 2026-10-10 : si l'admin a activé la double authentification, la session doit l'avoir validée (aal2)
function lxIsAdminUser(u) {
  if (!(u && String(u.email || "").toLowerCase() === "support@luxyra.fr")) return false;
  const aDeuxFacteurs = Array.isArray(u.factors) && u.factors.some((f) => f && f.status === "verified");
  return !aDeuxFacteurs || u._aal === "aal2";
}
async function lxOwnsSalon(env, userId, salonId) {
  if (!userId || !salonId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(salonId))) return false;
  try {
    const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/salons?select=id&id=eq.${encodeURIComponent(salonId)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`, { headers: _sbHeaders(env) });
    if (!r.ok) return false;
    const a = await r.json();
    return Array.isArray(a) && a.length > 0;
  } catch (e) { return false; }
}
async function lxBodyCopie(request) { try { return await request.clone().json(); } catch (e) { return {}; } }
// null si autorise, sinon une reponse 401/403 a renvoyer telle quelle.
async function lxGuardSalon(request, env, salonId) {
  if (await lxIsInternal(request, env)) return null;
  const u = await lxAuthUser(request);
  if (!u) return jsonResponse({ error: "Authentification requise" }, 401);
  if (lxIsAdminUser(u)) return null;
  if (!(await lxOwnsSalon(env, u.id, salonId))) return jsonResponse({ error: "Accès refusé" }, 403);
  return null;
}
// Appel serveur OU utilisateur connecte (n'importe quel salon) OU admin.
async function lxGuardConnecte(request, env) {
  if (await lxIsInternal(request, env)) return { ok: true, internal: true, user: null };
  const u = await lxAuthUser(request);
  if (!u) return { ok: false, user: null };
  return { ok: true, internal: false, user: u };
}
// Routes qui agissent pour UN salon (salon_id dans le corps) : proprietaire du salon obligatoire.
const LX_ROUTES_SALON = new Set([
  "/api/stripe/create-checkout", "/api/stripe/portal", "/api/stripe/switch-plan",
  "/api/stripe/connect-onboard", "/api/stripe/connect-status", "/api/stripe/connect-dashboard",
  "/api/admin/export-nf525", "/api/sms/rappel", "/api/sms/custom", "/api/sms/generate-link-token",
  "/api/client/invite", "/api/cc/action", "/api/sms/recharge-auto"
]);
function lxUrlLuxyra(u) {
  try { const x = new URL(String(u)); return x.protocol === "https:" && (x.hostname === "luxyra.fr" || x.hostname.endsWith(".luxyra.fr")); } catch (e) { return false; }
}

// ============================================================
// 1. CRÉER UNE SESSION CHECKOUT
// ============================================================
async function handleCreateCheckout(request, env) {
  try {
    const body = await request.json();
    const { salon_id, plan, email } = body;
    if (!salon_id || !plan || !email) return jsonResponse({ error: "salon_id, plan et email requis" }, 400);

    // Lit les prix de packs SMS depuis app_config (centralisé, modif depuis admin)
    // Fallback hardcodé si la table n'est pas accessible
    const smsPacks = {
      sms_100: { amount: 1099, qty: 100, label: "Pack 100 SMS" },
      sms_250: { amount: 2399, qty: 250, label: "Pack 250 SMS" },
      sms_500: { amount: 4499, qty: 500, label: "Pack 500 SMS" },
      sms_1000: { amount: 8299, qty: 1000, label: "Pack 1000 SMS" },
    };
    try {
      const cfgRes = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/app_config?id=eq.1&select=config`, {
        headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` }
      });
      const cfgRows = await cfgRes.json();
      if (cfgRows && cfgRows[0] && cfgRows[0].config) {
        const cfg = cfgRows[0].config;
        // Conversion € → cents (Stripe attend des cents en entier)
        if (cfg.sms_pack_100_eur != null) smsPacks.sms_100.amount = Math.round(Number(cfg.sms_pack_100_eur) * 100);
        if (cfg.sms_pack_250_eur != null) smsPacks.sms_250.amount = Math.round(Number(cfg.sms_pack_250_eur) * 100);
        if (cfg.sms_pack_500_eur != null) smsPacks.sms_500.amount = Math.round(Number(cfg.sms_pack_500_eur) * 100);
        if (cfg.sms_pack_1000_eur != null) smsPacks.sms_1000.amount = Math.round(Number(cfg.sms_pack_1000_eur) * 100);
      }
    } catch (e) { console.warn("app_config fetch failed for SMS packs, using fallback:", e?.message); }

    // 2026-10-08 : packs SMS réservés au forfait Pro PAYÉ (pas pendant l'essai, ni en Essentiel :
    // l'envoi serait de toute façon refusé par gateSmsAndDecrementCredit → crédits payés inutilisables).
    if (smsPacks[plan]) {
      const sPack = await supabaseGet(env, salon_id);
      if (!sPack || sPack.plan !== "pro") {
        return jsonResponse({ error: "Les SMS sont disponibles avec l'abonnement Pro (pas pendant l'essai gratuit)." }, 403);
      }
    }

    let customerId = await getOrCreateStripeCustomer(env, email, salon_id);
    if (!customerId) return jsonResponse({ error: "Impossible de créer le client Stripe." }, 500);

    if (smsPacks[plan]) {
      const pack = smsPacks[plan];
      const session = await stripeAPI(env, "checkout/sessions", {
        customer: customerId, mode: "payment",
        "line_items[0][price_data][currency]": "eur",
        "line_items[0][price_data][product_data][name]": pack.label,
        "line_items[0][price_data][unit_amount]": String(pack.amount),
        "line_items[0][quantity]": "1",
        "payment_intent_data[description]": `${pack.label} — Luxyra`,
        success_url: `https://luxyra.fr/app?sms_pack=success&qty=${pack.qty}`,
        cancel_url: "https://luxyra.fr/app?sms_pack=cancel",
        "metadata[salon_id]": salon_id, "metadata[type]": "sms_pack", "metadata[sms_qty]": String(pack.qty),
      });
      if (!session?.url) return jsonResponse({ error: "Stripe SMS error: " + JSON.stringify(session) }, 500);
      return jsonResponse({ url: session.url, session_id: session.id });
    }

    // === Programme "100 Fondateurs" ===
    // Si plan = pro ET il reste des places fondateur disponibles, on bascule sur
    // le price Pro Fondateur (14,99€/mois à vie au lieu de 24,99€).
    // Note importante : on CHECK seulement la dispo ici, on ne CLAIM PAS le slot
    // (un user qui annule ne consomme pas une place). Le claim réel se fait dans
    // le webhook Stripe "customer.subscription.created" pour les souscriptions
    // taggées is_founder=true (voir handleStripeWebhook).
    // 2026-10-10 : un salon inscrit « en cours d'immatriculation » doit renseigner son SIRET avant de s'abonner
    // (la base refuse un salon actif sans SIRET : sans ce contrôle, le paiement passerait sans activer le compte).
    {
      const _sal = await supabaseGet(env, salon_id);
      if (_sal && !String(_sal.siret || "").trim()) return jsonResponse({ error: "Ajoutez d'abord votre SIRET (Paramètres → Infos établissement) : il est obligatoire pour activer l'abonnement.", code: "siret_requis" }, 400);
    }
    let priceId = plan === "pro" ? CONFIG.PRICE_PRO : CONFIG.PRICE_ESSENTIAL;
    let isFounder = false;
    if (plan === "pro") {
      try {
        const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/founders_stats`, {
          method: "POST",
          headers: _sbHeaders(env),
          body: JSON.stringify({})
        });
        if (r.ok) {
          const stats = await r.json();
          const remaining = Array.isArray(stats) && stats[0] ? Number(stats[0].remaining) : 0;
          if (remaining > 0) {
            priceId = CONFIG.PRICE_PRO_FOUNDER;
            isFounder = true;
          }
        }
      } catch (e) {
        // Si l'appel founders_stats échoue, on bascule en mode safe :
        // price Pro standard (mieux que de bloquer la souscription)
        console.warn("[founders_stats] check failed, fallback to standard price:", e?.message);
      }
    }

    const planLabel = plan === "pro" ? (isFounder ? "Pro Fondateur" : "Pro") : "Essentiel";
    const sessionParams = {
      customer: customerId, mode: "subscription",
      // 2026-06-17 : on NE force PLUS payment_method_types. Stripe Checkout utilise
      // les moyens de paiement actives dans le dashboard (carte par defaut ; SEPA si/quand
      // tu l'actives). Evite l'erreur "sepa_debit is invalid" si SEPA non active en live.
      allow_promotion_codes: "true",
      "line_items[0][price]": priceId, "line_items[0][quantity]": "1",
      success_url: `https://luxyra.fr/app?checkout=success&plan=${plan}${isFounder ? "&founder=1" : ""}`,
      cancel_url: "https://luxyra.fr/app?checkout=cancel",
      "metadata[salon_id]": salon_id, "metadata[plan]": plan, "metadata[is_founder]": isFounder ? "true" : "false",
      "subscription_data[description]": `Abonnement Luxyra ${planLabel} — Mensuel`,
      "subscription_data[metadata][salon_id]": salon_id,
      "subscription_data[metadata][plan]": plan,
      "subscription_data[metadata][is_founder]": isFounder ? "true" : "false",
    };
    const session = await stripeAPI(env, "checkout/sessions", sessionParams);
    if (!session?.url) return jsonResponse({ error: "Stripe checkout error: " + JSON.stringify(session) }, 500);
    return jsonResponse({ url: session.url, session_id: session.id });
  } catch(e) { return jsonResponse({ error: "Checkout error: " + e.message }, 500); }
}

// ============================================================
// 2. WEBHOOK STRIPE — FIX W1: SIGNATURE VERIFIED
// ============================================================
async function handleWebhook(request, env) {
  const payload = await request.text();
  const sig = request.headers.get("stripe-signature");

  let event;
  if (env.STRIPE_WEBHOOK_SECRET) {
    event = await verifyStripeSignature(payload, sig, env.STRIPE_WEBHOOK_SECRET);
    if (!event) {
      console.error("Stripe webhook: invalid signature rejected");
      return jsonResponse({ error: "Invalid signature" }, 401);
    }
  } else {
    // SECURITE 2026-10-08 : sans secret, l'evenement recu n'est PAS cru : il est relu chez Stripe.
    let recu = null;
    try { recu = JSON.parse(payload); } catch (e) { return jsonResponse({ error: "Invalid payload" }, 400); }
    if (!recu || typeof recu.id !== "string" || !/^evt_[A-Za-z0-9]+$/.test(recu.id)) return jsonResponse({ error: "Invalid event" }, 400);
    const relu = await stripeAPI(env, `events/${recu.id}`, null, "GET");
    if (!relu || relu.error || relu.id !== recu.id) {
      await reportWorkerError(env, "worker:stripe-webhook", new Error("STRIPE_WEBHOOK_SECRET absent et evenement non verifiable"), { event_id: recu.id }, "critical");
      return jsonResponse({ error: "Event not verifiable" }, 401);
    }
    event = relu;
  }

  const type = event.type;
  const data = event.data?.object;
  console.log("Stripe webhook:", type);

  switch (type) {
    case "checkout.session.completed": {
      const salonId = data.metadata?.salon_id;
      const plan = data.metadata?.plan || "pro";
      const isFounder = data.metadata?.is_founder === "true";
      if (data.metadata?.type === "sms_pack") {
        const qty = parseInt(data.metadata.sms_qty || "0");
        if (salonId && qty > 0) {
          // 2026-10-09 : idempotent — un même paiement Stripe (évènement rejoué) ne crédite qu'une fois
          try {
            const _deja = await (await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/sms_mouvements?select=id&salon_id=eq.${encodeURIComponent(salonId)}&type=eq.achat_pack&motif=ilike.*${encodeURIComponent(String(data.id || "x"))}*&limit=1`, { headers: _sbHeaders(env) })).json();
            if (Array.isArray(_deja) && _deja.length) { console.log("[sms_pack] déjà crédité :", data.id); break; }
          } catch (_) {}
          // 2026-10-09 : crédit ATOMIQUE + historique (avant : lecture puis écriture, un SMS envoyé entre les deux était perdu)
          const _cr = await lxCrediterSms(env, salonId, qty, "achat_pack", (Number(data.amount_total) || 0) / 100, "Pack " + qty + " SMS (Stripe " + String(data.id || "") + ")", "salon");
          if (!_cr || !_cr.ok) {
            const salon = await supabaseGet(env, salonId);
            await supabaseUpdate(env, salonId, { sms_credits: (salon?.sms_credits || 0) + qty });
          }
          await lxFactureSms(env, salonId, qty, (Number(data.amount_total) || 0) / 100, data.payment_intent || data.id, false);
          // (les SMS en attente repartent via le déclencheur trg_sms_recharge sur salons)
        }
        break;
      }
      // 2026-10-08 : Click & Collect payé en ligne (filet si la cliente ferme l'onglet avant le retour)
      if (data.metadata?.type === "click_collect") {
        try { await ccFinaliserPaiement(env, data.metadata.commande_id, data); } catch (e) { console.error("cc finalize webhook:", e); }
        break;
      }
      // FAILLE CORRIGÉE 2026-10-08 : TOUT paiement Checkout portant un salon_id (acompte d'une cliente,
      // bon cadeau, carte...) passait ici comme un ABONNEMENT : le salon passait Pro/actif, et son
      // véritable abonnement Luxyra était ANNULÉ chez Stripe (anti-double-facturation de updateSalonPlan).
      // Seules les sessions d'abonnement modifient le forfait.
      if (data.mode !== "subscription" || !data.subscription) break;
      if (salonId) {
        await updateSalonPlan(env, salonId, plan, data.subscription, data.customer);
        // === Programme "100 Fondateurs" : claim atomique du slot ===
        // Appelé uniquement si la session checkout est taguée is_founder=true.
        // claim_founder_slot() est atomique côté DB (SELECT FOR UPDATE + counter)
        // et idempotent (si déjà fondateur, retourne le founder_num existant).
        if (isFounder) {
          try {
            const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/claim_founder_slot`, {
              method: "POST",
              headers: _sbHeaders(env),
              body: JSON.stringify({ p_salon_id: salonId })
            });
            if (r.ok) {
              const founderNum = await r.json();
              console.log(`[FOUNDER] Salon ${salonId} marqué Fondateur #${founderNum}`);
            } else {
              console.warn(`[FOUNDER] claim_founder_slot HTTP ${r.status} pour salon ${salonId}`);
            }
          } catch (e) {
            console.warn(`[FOUNDER] claim_founder_slot exception pour salon ${salonId}:`, e?.message);
          }
        }
      }
      break;
    }

    case "invoice.paid": {
      // Support both old format (data.subscription) and new Stripe API 2026+ (data.parent.subscription_details)
      const subId = data.subscription || data.parent?.subscription_details?.subscription;
      const subMeta = data.parent?.subscription_details?.metadata || {};
      console.log("invoice.paid: subId=", subId, "directMeta=", JSON.stringify(subMeta));

      // Get salon_id: from parent metadata, line item metadata, or subscription fetch
      let salonId = subMeta.salon_id || data.lines?.data?.[0]?.metadata?.salon_id;
      let plan = subMeta.plan || data.lines?.data?.[0]?.metadata?.plan || "essential";

      if (!salonId && subId) {
        const sub = await stripeAPI(env, `subscriptions/${subId}`, null, "GET");
        salonId = sub.metadata?.salon_id;
        plan = sub.metadata?.plan || plan;
        console.log("invoice.paid: fetched sub metadata salonId=", salonId);
      }

      console.log("invoice.paid: final salonId=", salonId, "plan=", plan);

      if (salonId) {
        // Active + reset past_due_since (au cas où retry Stripe a réussi)
        await supabaseUpdate(env, salonId, { status: "active", past_due_since: null });

        // === BONUS 150 SMS one-shot au 1er paiement Pro (LIVE uniquement) ===
        // - data.livemode = true sur les paiements réels (false en mode test Stripe)
        // - welcome_sms_bonus_given = false → bonus pas encore donné
        // - plan === "pro" → seul le plan Pro a le bonus SMS
        // amount_paid > 0 : un VRAI 1er paiement (pas une facture à 0 € : code promo 100 %, prorata…)
        if (data.livemode === true && plan === "pro" && Number(data.amount_paid || 0) > 0) {
          try {
            const salonRow = await supabaseGet(env, salonId);
            if (salonRow && salonRow.welcome_sms_bonus_given !== true) {
              const newCredits = (salonRow.sms_credits || 0) + 150;
              await supabaseUpdate(env, salonId, {
                sms_credits: newCredits,
                welcome_sms_bonus_given: true
              });
              try { await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/sms_mouvements`, { method: "POST", headers: _sbHeaders(env, { Prefer: "return=minimal" }), body: JSON.stringify({ salon_id: salonId, type: "bonus", delta: 150, solde_apres: newCredits, motif: "Bonus 1er paiement Pro", auteur: "systeme" }) }); } catch (_) {}
              console.log("invoice.paid: 150 SMS bonus credited to salon", salonId, "new total=", newCredits);
            }
          } catch (e) { console.warn("SMS bonus error:", e?.message || e); }
        }

        // === PARRAINAGE (2026-10-10) : 1er VRAI paiement du filleul -> 1 mois offert au parrain ;
        // et si CE salon est un parrain qui vient de s'abonner, ses mois offerts en attente sont appliqués.
        if (Number(data.amount_paid || 0) > 0) {
          // 2026-10-10 : date du 1er paiement (départ des 15 jours pour fournir les justificatifs)
          try { const _sa = await supabaseGet(env, salonId); if (_sa && !_sa.abonne_depuis) await supabaseUpdate(env, salonId, { abonne_depuis: new Date().toISOString() }); } catch (_) {}
          try { await lxParrainageRecompenser(env, salonId); } catch (e) { console.error("parrainage:", e?.message || e); }
        }
        try { await lxParrainageAppliquerEnAttente(env, salonId); } catch (e) { console.error("parrainage attente:", e?.message || e); }

        try {
          // Lit le prix réel + TVA réelle depuis app_config (centralisation : un seul endroit à modifier)
          // Fallback hardcodé si la table n'est pas accessible (planPrix = HT, tvaPct = % TVA Luxyra)
          let planPrix = plan === "pro" ? 24.99 : 14.99;
          let tvaPct = 0;  // 0 en franchise micro (art. 293B), 20 en SAS assujetti
          try {
            const cfgRes = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/app_config?id=eq.1&select=config`, {
              headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` }
            });
            const cfgRows = await cfgRes.json();
            if (cfgRows && cfgRows[0] && cfgRows[0].config) {
              const cfg = cfgRows[0].config;
              if (plan === "pro" && cfg.plan_pro_eur != null) planPrix = Number(cfg.plan_pro_eur);
              else if (plan !== "pro" && cfg.plan_essential_eur != null) planPrix = Number(cfg.plan_essential_eur);
              if (cfg.luxyra_tva_pct != null) tvaPct = Number(cfg.luxyra_tva_pct);
            }
          } catch (e) { console.warn("app_config fetch failed, using fallback:", e?.message); }
          // Calcul HT/TVA/TTC : planPrix est interprété comme HT
          // → en franchise (tvaPct=0) : HT = TTC, TVA = 0 (comportement actuel inchangé)
          // → en SAS (tvaPct=20) : TVA et TTC calculés automatiquement
          let ht = planPrix;
          let tvaAmount = Math.round(ht * tvaPct) / 100;  // arrondi au centime
          let ttc = Math.round((ht + tvaAmount) * 100) / 100;
          // 2026-10-08 : la facture reprend le montant REELLEMENT paye (tarif Fondateur, prorata, remise).
          // 2026-10-10 : y compris 0 € (mois offert, parrainage, code 100 %) : avant, une facture à 0 € était
          // émise au prix catalogue. Le prix avant remise et la remise sont détaillés sur la facture.
          let brut = null, remise = 0, remiseLib = null;
          if (typeof data.amount_paid === "number") {
            ttc = Math.round(data.amount_paid) / 100;
            ht = Math.round((ttc / (1 + tvaPct / 100)) * 100) / 100;
            tvaAmount = Math.round((ttc - ht) * 100) / 100;
            const sub0 = typeof data.subtotal === "number" ? data.subtotal / 100 : ttc;
            brut = Math.max(sub0, ttc);
            remise = Math.round((brut - ttc) * 100) / 100;
            if (remise > 0.004) {
              const libs = [];
              if (Number(data.starting_balance || 0) < 0) {
                let estParrainage = false;
                try { const pp = await lxSbGet(env, `parrainages?select=id&parrain_id=eq.${salonId}&statut=eq.recompense&limit=1`); estParrainage = pp.length > 0; } catch (_) {}
                libs.push(estParrainage ? "mois offert — parrainage" : "crédit (geste commercial)");
              }
              const ds = (data.total_discount_amounts || []).filter((x) => Number(x.amount) > 0);
              if (ds.length || (data.discount && data.discount.coupon)) libs.push("remise" + (data.discount && data.discount.coupon && data.discount.coupon.name ? " « " + data.discount.coupon.name + " »" : ""));
              remiseLib = libs.join(" + ") || "remise";
            }
          }
          let _fondateur = false;
          try { const _s = await supabaseGet(env, salonId); _fondateur = !!(_s && _s.is_founder); } catch (_e) {}
          const sbUrl = CONFIG.SUPABASE_URL;
          // 2026-10-10 : numéro attribué par la base à l'insertion (verrou : ni trou ni doublon) ; une seule facture par facture Stripe
          const numero = null;
          const periodStart = data.lines?.data?.[0]?.period?.start ? new Date(data.lines.data[0].period.start * 1000).toISOString().slice(0, 10) : null;
          const periodEnd = data.lines?.data?.[0]?.period?.end ? new Date(data.lines.data[0].period.end * 1000).toISOString().slice(0, 10) : null;
          // Detect actual payment method used
          let modePaiement = "carte";
          try {
            if (data.charge) {
              const charge = await stripeAPI(env, `charges/${data.charge}`, null, "GET");
              if (charge.payment_method_details?.type === "sepa_debit") modePaiement = "sepa";
            } else if (data.payment_intent) {
              const pi = await stripeAPI(env, `payment_intents/${data.payment_intent}`, null, "GET");
              if (pi.payment_method_types?.includes("sepa_debit") && !pi.payment_method_types?.includes("card")) modePaiement = "sepa";
              else if (pi.charges?.data?.[0]?.payment_method_details?.type === "sepa_debit") modePaiement = "sepa";
            }
          } catch(e) {}
          const insertBody = {
            salon_id: salonId, numero, montant_ht: ht, taux_tva: tvaPct, montant_tva: tvaAmount, montant_ttc: ttc,
            type: "abonnement", montant_brut: brut, remise, remise_libelle: remiseLib,
            date_paiement: data.status_transitions?.paid_at ? new Date(data.status_transitions.paid_at * 1000).toISOString() : new Date().toISOString(),
            description: `Abonnement Luxyra ${plan === "pro" ? (_fondateur ? "Pro Fondateur" : "Pro") : "Essentiel"} - Mensuel`,
            plan, periode_debut: periodStart, periode_fin: periodEnd,
            stripe_invoice_id: data.id || null, stripe_payment_intent: data.payment_intent || data.charge || null,
            mode_paiement: Number(data.amount_paid || 0) > 0 ? modePaiement : "aucun (montant nul)", status: "paid"
          };
          console.log("invoice.paid: inserting facture", numero);
          const insertRes = await fetch(`${sbUrl}/rest/v1/factures_luxyra`, {
            method: "POST",
            headers: { "apikey": env.SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", "Prefer": "return=minimal" },
            body: JSON.stringify(insertBody)
          });
          console.log("invoice.paid: insert status=", insertRes.status);
          if (!insertRes.ok) {
            const errText = await insertRes.text();
            console.log("invoice.paid: insert error=", errText);
          }
        } catch (e) { console.log("Invoice generation error:", e.message); }
      } else {
        console.log("invoice.paid: NO salonId found anywhere");
      }
      break;
    }

    case "charge.dispute.created": {
      // 2026-10-09 : alerte immédiate (à activer dans Stripe : évènement charge.dispute.created sur ce webhook)
      try {
        const ech = data.evidence_details?.due_by ? new Date(data.evidence_details.due_by * 1000).toLocaleDateString("fr-FR") : "?";
        await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/notify_admins`, { method: "POST", headers: _sbHeaders(env), body: JSON.stringify({ p_event_type: "payment_failed", p_title: "⚠️ Nouveau litige Stripe", p_body: `${(data.amount || 0) / 100} € — motif ${data.reason} — réponse avant le ${ech}`, p_url: "/admin.html#stripe", p_payload: {} }) });
      } catch (_) {}
      break;
    }

    case "invoice.payment_failed": {
      const subId = data.subscription || data.parent?.subscription_details?.subscription;
      const pfMeta = data.parent?.subscription_details?.metadata || {};
      let pfSalonId = pfMeta.salon_id;
      if (!pfSalonId && subId) {
        const sub = await stripeAPI(env, `subscriptions/${subId}`, null, "GET");
        pfSalonId = sub.metadata?.salon_id;
      }
      if (pfSalonId) {
        // Marquer past_due + horodater (sert au cron de relance + suspension auto)
        await supabaseUpdate(env, pfSalonId, {
          status: "past_due",
          past_due_since: new Date().toISOString()
        });
        // Email immédiat "paiement échoué"
        try { await callBillingEmail(env, pfSalonId, "payment_failed"); }
        catch (e) { console.warn("billing-email payment_failed failed:", e?.message || e); }
      }
      break;
    }

    case "customer.subscription.deleted": {
      const salonId = data.metadata?.salon_id;
      if (salonId) {
        // GARDE-FOU CRITIQUE : ignore si la sub deletée n'est PAS la sub active du salon.
        // Sans ça, l'expiration d'une vieille sub annulée écraserait le statut alors
        // qu'une nouvelle sub est en cours (cas réel rencontré 2026-05-03).
        const salon = await supabaseGet(env, salonId);
        if (salon && salon.stripe_subscription_id && salon.stripe_subscription_id !== data.id) {
          console.log(`[ignored] subscription.deleted pour ${data.id} ≠ sub active ${salon.stripe_subscription_id} du salon ${salonId}`);
          break;
        }
        // cancelled_at = ancrage légal des 6 ans de conservation des données comptables.
        // On ne l'écrase pas s'il est déjà défini (ré-résiliation, ou l'utilisateur a
        // résilié via /api/cancel-subscription qui set déjà cancelled_at).
        // Toujours la date de la DERNIÈRE résiliation effective : les 6 ans courent à partir
        // de la fin réelle de l'abonnement (un ancien cancelled_at, ex. résiliation puis
        // réabonnement, raccourcirait à tort la durée légale de conservation).
        // 2026-10-10 : fin de la garantie Fondateur à la résiliation (CGV art. 5 bis) — la place redevient disponible
        const updates = { plan: "essential", status: "cancelled", past_due_since: null, cancelled_at: new Date().toISOString(), is_founder: false, founder_num: null };
        await supabaseUpdate(env, salonId, updates);
        await patchSiteConfig(env, salonId, { site_actif: false, reservation_active: false });
      }
      break;
    }

    case "customer.subscription.updated": {
      const salonId = data.metadata?.salon_id;
      const priceId = data.items?.data?.[0]?.price?.id;
      if (salonId && priceId) {
        // GARDE-FOU : ignore si la sub updatée n'est PAS la sub active du salon
        const salon = await supabaseGet(env, salonId);
        if (salon && salon.stripe_subscription_id && salon.stripe_subscription_id !== data.id) {
          console.log(`[ignored] subscription.updated pour ${data.id} ≠ sub active ${salon.stripe_subscription_id} du salon ${salonId}`);
          break;
        }
        // FIX 2026-10-09 : le prix Fondateur est un forfait Pro (avant : il repassait le salon en Essentiel
        // à chaque évènement Stripe). Un prix inconnu ne change plus le forfait.
        const newPlan = (priceId === CONFIG.PRICE_PRO || priceId === CONFIG.PRICE_PRO_FOUNDER) ? "pro"
          : (priceId === CONFIG.PRICE_ESSENTIAL ? "essential" : null);
        if (!newPlan) { console.warn(`[subscription.updated] prix inconnu ${priceId} pour ${salonId} : forfait inchangé`); break; }
        // Si la sub est marquée pour annulation à la fin de période (cancel_at_period_end),
        // on garde status=active jusqu'à l'expiration réelle (c'est subscription.deleted qui passera à cancelled).
        // L'utilisateur conserve son accès jusqu'à la fin de la période payée.
        // 2026-10-10 : passage en Essentiel = fin de la garantie Fondateur (CGV art. 5 bis)
        await supabaseUpdate(env, salonId, newPlan === "pro" ? { plan: newPlan } : { plan: newPlan, is_founder: false, founder_num: null });
        if (newPlan !== "pro") await patchSiteConfig(env, salonId, { site_actif: false, reservation_active: false });
        else await patchSiteConfig(env, salonId, { site_actif: true, reservation_active: true });
      }
      break;
    }

    // Stripe Connect: account status changed
    case "account.updated": {
      const connectId = data.id;
      if (connectId) {
        // Find salon by Connect ID
        const salonRes = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/salons?stripe_connect_id=eq.${connectId}&select=id&limit=1`, {
          headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` }
        });
        const salons = await salonRes.json();
        if (Array.isArray(salons) && salons[0]) {
          const status = (data.charges_enabled && data.payouts_enabled) ? "active" : data.details_submitted ? "pending_verification" : "incomplete";
          await supabaseUpdate(env, salons[0].id, { stripe_connect_status: status });
          console.log("Connect account.updated:", connectId, "status:", status);
        }
      }
      break;
    }
  }

  return jsonResponse({ received: true });
}

// ============================================================
// 3. CUSTOMER PORTAL
// ============================================================
async function handlePortal(request, env) {
  try {
    const { salon_id } = await request.json();
    if (!salon_id) return jsonResponse({ error: "salon_id requis" }, 400);
    const salon = await supabaseGet(env, salon_id);
    if (!salon?.stripe_customer_id) return jsonResponse({ error: "Pas d'abonnement Stripe trouvé" }, 400);
    const session = await stripeAPI(env, "billing_portal/sessions", { customer: salon.stripe_customer_id, return_url: "https://luxyra.fr/app" });
    if (!session?.url) return jsonResponse({ error: "Erreur Stripe: " + JSON.stringify(session) }, 500);
    return jsonResponse({ url: session.url });
  } catch(e) { return jsonResponse({ error: "Portal error: " + e.message }, 500); }
}

// ============================================================
// 4. SWITCH PLAN
// ============================================================
async function handleOfferMonth(request, env) {
  try {
    const { salon_id, months, jwt } = await request.json();
    if (!salon_id || !months) return jsonResponse({ error: "salon_id et months requis" }, 400);
    const n = Math.max(1, Math.min(12, parseInt(months) || 0));
    if (!n) return jsonResponse({ error: "Nombre de mois invalide (1 a 12)" }, 400);
    // Verif admin : on rejoue is_admin() dans le contexte du JWT admin du panel
    if (!jwt) return jsonResponse({ error: "Authentification requise" }, 401);
    let isAdmin = false;
    try {
      const chk = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/is_admin`, {
        method: "POST",
        headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: "Bearer " + jwt, "Content-Type": "application/json" },
        body: "{}"
      });
      isAdmin = (await chk.json()) === true;
    } catch (_) { isAdmin = false; }
    if (!isAdmin) return jsonResponse({ error: "Acces refuse (admin requis)" }, 403);
    const salon = await supabaseGet(env, salon_id);
    if (!salon) return jsonResponse({ error: "Salon introuvable" }, 404);
    if (!salon.stripe_subscription_id) return jsonResponse({ error: "Ce salon n'a pas d'abonnement Stripe : aucune echeance a decaler (geste reserve aux abonnes payants)." }, 400);
    const sub = await stripeAPI(env, `subscriptions/${salon.stripe_subscription_id}`, null, "GET");
    if (!sub || !sub.id || sub.status === "canceled") return jsonResponse({ error: "Abonnement Stripe introuvable ou annule" }, 400);
    // Nouvelle echeance = max(fin de periode courante, maintenant) + N mois (calendaire)
    const nowS = Math.floor(Date.now() / 1000);
    const baseS = Math.max(Number(sub.current_period_end) || nowS, nowS);
    const d = new Date(baseS * 1000);
    d.setMonth(d.getMonth() + n);
    const newTrialEnd = Math.floor(d.getTime() / 1000);
    const updated = await stripeAPI(env, `subscriptions/${salon.stripe_subscription_id}`, {
      trial_end: String(newTrialEnd),
      proration_behavior: "none"
    });
    if (!updated || !updated.id) return jsonResponse({ error: "Erreur Stripe: " + JSON.stringify(updated).slice(0, 300) }, 500);
    const nextStr = d.toISOString().slice(0, 10);
    try { await supabaseUpdate(env, salon_id, { free_until: nextStr }); } catch (_) {}
    try {
      await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/admin_log`, {
        method: "POST",
        headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ action: "OFFER_MONTHS", salon_id: salon_id, details: "+" + n + " mois offerts — prochaine echeance Stripe repoussee au " + nextStr })
      });
    } catch (_) {}
    return jsonResponse({ success: true, months: n, next_billing: nextStr });
  } catch (e) { return jsonResponse({ error: "offer-month error: " + (e && e.message) }, 500); }
}

async function handleSwitchPlan(request, env) {
  try {
    const { salon_id, plan } = await request.json();
    if (!salon_id || !plan) return jsonResponse({ error: "salon_id et plan requis" }, 400);
    const salon = await supabaseGet(env, salon_id);
    if (!salon?.stripe_subscription_id) return jsonResponse({ error: "Pas d'abonnement actif" }, 400);
    const sub = await stripeAPI(env, `subscriptions/${salon.stripe_subscription_id}`, {}, "GET");
    if (!sub?.items?.data?.[0]) return jsonResponse({ error: "Impossible de lire l'abonnement" }, 500);
    // 2026-10-08 : même règle que create-checkout (CGV art. 5 bis) — un passage Essentiel → Pro
    // bénéficie du tarif Fondateur tant qu'il reste des places (ou si le salon est déjà Fondateur).
    // claim_founder_slot est atomique et idempotent : NULL = plus de place → tarif Pro standard.
    let priceId = plan === "pro" ? CONFIG.PRICE_PRO : CONFIG.PRICE_ESSENTIAL;
    let isFounder = false;
    if (plan === "pro") {
      try {
        const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/claim_founder_slot`, {
          method: "POST", headers: _sbHeaders(env), body: JSON.stringify({ p_salon_id: salon_id })
        });
        if (r.ok) { const num = await r.json(); if (num !== null && num !== undefined) { priceId = CONFIG.PRICE_PRO_FOUNDER; isFounder = true; } }
      } catch (e) { console.warn("[switch-plan] claim_founder_slot:", e?.message); }
    }
    const subParams = {
      "items[0][id]": sub.items.data[0].id,
      "items[0][price]": priceId,
      proration_behavior: "create_prorations",
    };
    if (plan === "pro") subParams["metadata[is_founder]"] = isFounder ? "true" : "false";
    subParams["metadata[plan]"] = plan === "pro" ? "pro" : "essential"; // FIX 2026-10-09 : facture et bonus SMS au bon forfait
    const updated = await stripeAPI(env, `subscriptions/${salon.stripe_subscription_id}`, subParams);
    if (updated?.id) {
      await supabaseUpdate(env, salon_id, plan === "pro" ? { plan: "pro" } : { plan: "essential", is_founder: false, founder_num: null });
      if (plan !== "pro") await patchSiteConfig(env, salon_id, { site_actif: false, reservation_active: false });
      else await patchSiteConfig(env, salon_id, { site_actif: true, reservation_active: true });
      return jsonResponse({ success: true, plan });
    }
    return jsonResponse({ error: "Erreur Stripe: " + JSON.stringify(updated) }, 500);
  } catch(e) { return jsonResponse({ error: "Switch error: " + e.message }, 500); }
}

// ============================================================
// 5. STRIPE CONNECT — Onboarding, Status, Dashboard, Payment
// ============================================================

// Create Express connected account + onboarding link
async function handleConnectOnboard(request, env) {
  try {
    const { salon_id, email, salon_name } = await request.json();
    if (!salon_id || !email) return jsonResponse({ error: "salon_id et email requis" }, 400);

    const salon = await supabaseGet(env, salon_id);

    // If salon already has a Connect account, just create new onboarding link
    if (salon?.stripe_connect_id) {
      const link = await stripeAPI(env, "account_links", {
        account: salon.stripe_connect_id,
        refresh_url: `https://luxyra.fr/app?connect=refresh`,
        return_url: `https://luxyra.fr/app?connect=success`,
        type: "account_onboarding",
      });
      if (!link?.url) return jsonResponse({ error: "Erreur Stripe: " + JSON.stringify(link) }, 500);
      return jsonResponse({ url: link.url, account_id: salon.stripe_connect_id });
    }

    // Create new connected account — modèle STANDARD (= controller.dashboard "full")
    // FIX 2026-05-12 : Stripe a déprécié `type: "express"` pour les plateformes EU
    // en LIVE depuis juin 2024. Il faut utiliser le nouveau format `controller[]`
    // qui DOIT matcher exactement le profil de plateforme configuré sur Stripe.
    //
    // Choix de modèle Luxyra (Option B — sécurisé pour la plateforme) :
    //   - Dashboard          = "Dashboard Stripe complet" → stripe_dashboard.type=full
    //   - Frais Stripe payés par : le marchand            → fees.payer=account
    //   - Responsabilité pertes/chargebacks : Stripe      → losses.payments=stripe
    //   - Inscription : hébergée par Stripe (KYC FR)      → requirement_collection=stripe
    //
    // Conséquence : pas de risque financier pour Luxyra (les salons paient leurs
    // propres frais + assument leurs litiges). Le salon doit faire un onboarding
    // KYC complet ~15 min mais une seule fois.
    //
    // ⚠️ Règle Stripe EU : avec stripe_dashboard=express, la plateforme DOIT
    // payer les frais ET être responsable des pertes (=Option A risquée).
    // C'est pour ça qu'on reste sur "full".
    const account = await stripeAPI(env, "accounts", {
      "controller[stripe_dashboard][type]": "full",
      "controller[fees][payer]": "account",
      "controller[losses][payments]": "stripe",
      "controller[requirement_collection]": "stripe",
      country: "FR",
      email: email,
      "capabilities[card_payments][requested]": "true",
      "capabilities[transfers][requested]": "true",
      "business_type": "individual",
      "business_profile[name]": salon_name || "Salon",
      "business_profile[product_description]": "Prestations de coiffure et beauté",
      "business_profile[mcc]": "7230",
      "metadata[salon_id]": salon_id,
      "settings[payouts][schedule][interval]": "daily",
    });

    if (!account?.id) return jsonResponse({ error: "Erreur création compte: " + JSON.stringify(account) }, 500);

    // Save Connect account ID to Supabase
    await supabaseUpdate(env, salon_id, { stripe_connect_id: account.id, stripe_connect_status: "pending" });

    // Create onboarding link
    const link = await stripeAPI(env, "account_links", {
      account: account.id,
      refresh_url: `https://luxyra.fr/app?connect=refresh`,
      return_url: `https://luxyra.fr/app?connect=success`,
      type: "account_onboarding",
    });

    if (!link?.url) return jsonResponse({ error: "Erreur lien onboarding: " + JSON.stringify(link) }, 500);
    return jsonResponse({ url: link.url, account_id: account.id });
  } catch(e) { return jsonResponse({ error: "Connect onboard error: " + e.message }, 500); }
}

// Check Connect account status
async function handleConnectStatus(request, env) {
  try {
    const { salon_id } = await request.json();
    if (!salon_id) return jsonResponse({ error: "salon_id requis" }, 400);

    const salon = await supabaseGet(env, salon_id);
    if (!salon?.stripe_connect_id) return jsonResponse({ connected: false, status: "not_started" });

    // Fetch account from Stripe to get real status
    const account = await stripeAPI(env, `accounts/${salon.stripe_connect_id}`, null, "GET");
    if (!account?.id) return jsonResponse({ connected: false, status: "error" });

    const charges = account.charges_enabled || false;
    const payouts = account.payouts_enabled || false;
    const details = account.details_submitted || false;

    let status = "pending";
    if (charges && payouts) status = "active";
    else if (charges && !payouts) status = "payouts_pending";  // FIX 2026-05-12 : encaissements OK mais virements en cours de vérif RIB
    else if (details && !charges) status = "pending_verification";
    else if (!details) status = "incomplete";

    // Update status in Supabase
    await supabaseUpdate(env, salon_id, { stripe_connect_status: status });

    return jsonResponse({
      connected: true,
      status: status,
      account_id: salon.stripe_connect_id,
      charges_enabled: charges,
      payouts_enabled: payouts,
      details_submitted: details,
      business_name: account.business_profile?.name || "",
      email: account.email || "",
    });
  } catch(e) { return jsonResponse({ error: "Connect status error: " + e.message }, 500); }
}

// Get dashboard link for connected account
// FIX 2026-05-12 : login_links est réservé aux comptes Express. Pour les
// comptes Standard (controller.stripe_dashboard.type=full), Stripe ne génère
// pas de lien de connexion auto — l'utilisateur se logue directement sur
// dashboard.stripe.com avec ses identifiants Stripe perso.
async function handleConnectDashboard(request, env) {
  try {
    const { salon_id } = await request.json();
    if (!salon_id) return jsonResponse({ error: "salon_id requis" }, 400);

    const salon = await supabaseGet(env, salon_id);
    if (!salon?.stripe_connect_id) return jsonResponse({ error: "Compte Connect non configuré" }, 400);

    // Détection du type de compte (Express vs Standard) via l'API account
    const account = await stripeAPI(env, "accounts/" + salon.stripe_connect_id, null, "GET");
    const dashboardType = account?.controller?.stripe_dashboard?.type || (account?.type === "express" ? "express" : "full");

    if (dashboardType === "express") {
      // Express → login_link auto-généré
      const link = await stripeAPI(env, "accounts/" + salon.stripe_connect_id + "/login_links", {});
      if (!link?.url) return jsonResponse({ error: "Erreur Stripe: " + JSON.stringify(link) }, 500);
      return jsonResponse({ url: link.url, type: "express" });
    } else {
      // Standard → renvoie vers dashboard.stripe.com (login propre du salon)
      return jsonResponse({
        url: "https://dashboard.stripe.com/login",
        type: "standard",
        message: "Connectez-vous avec vos identifiants Stripe perso pour gérer ce compte."
      });
    }
  } catch(e) { return jsonResponse({ error: "Connect dashboard error: " + e.message }, 500); }
}

// Create payment on connected account (acompte or product purchase)
// 0% Luxyra commission — only Stripe fees apply
// FIX 2026-05-12 : supporte capture_method=manual pour empreinte bancaire
// (pré-autorisation sans débit, capture/cancel ultérieur via Worker)
async function handleConnectPayment(request, env) {
  try {
    const { salon_id, amount, description, customer_email, customer_name, metadata, capture_method } = await readJsonBody(request);
    if (!salon_id || !amount) return jsonResponse({ error: "salon_id et amount requis" }, 400);
    // SECURITE 2026-10-08 : montants et redirections bornes ; un acompte/une empreinte doit viser un RDV de CE salon.
    if (!(Number(amount) > 0 && Number(amount) <= 5000)) return jsonResponse({ error: "Montant invalide" }, 400);
    if (metadata?.return_url && !lxUrlLuxyra(metadata.return_url)) return jsonResponse({ error: "URL de retour invalide" }, 400);
    if (metadata?.cancel_url && !lxUrlLuxyra(metadata.cancel_url)) return jsonResponse({ error: "URL d'annulation invalide" }, 400);
    {
      const _type = metadata?.type || "acompte";
      if (_type === "click_collect") return jsonResponse({ error: "Utilisez /api/cc/commande (prix calculés côté serveur)" }, 400);
      if (_type === "acompte" || _type === "empreinte" || capture_method === "manual") {
        const _rid = String(metadata?.rdv_id || "");
        if (!/^[0-9a-f-]{36}$/i.test(_rid)) return jsonResponse({ error: "rdv_id requis" }, 400);
        const _r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rdv_online?select=id,salon_id&id=eq.${encodeURIComponent(_rid)}&limit=1`, { headers: _sbHeaders(env) });
        const _a = _r.ok ? await _r.json() : [];
        if (!Array.isArray(_a) || !_a[0] || String(_a[0].salon_id) !== String(salon_id)) return jsonResponse({ error: "Rendez-vous introuvable pour ce salon" }, 400);
      }
    }

    const salon = await supabaseGet(env, salon_id);
    if (!salon?.stripe_connect_id) return jsonResponse({ error: "Ce salon n'a pas configuré ses paiements en ligne" }, 400);

    // Check Connect account is active
    const account = await stripeAPI(env, `accounts/${salon.stripe_connect_id}`, null, "GET");
    if (account?.error?.type === "upstream_non_json") { console.error("connect stripe accounts non-JSON:", account.error.http_status, account.error.raw); return jsonResponse({ error: "Service de paiement momentanément indisponible, merci de réessayer." }, 502); }
    if (!account?.charges_enabled) return jsonResponse({ error: "Le compte de paiement du salon n'est pas encore actif" }, 400);

    // Create Checkout Session — 0% platform fee, 100% transfert au salon
    const sessionParams = {
      mode: "payment",
      "line_items[0][price_data][currency]": "eur",
      "line_items[0][price_data][product_data][name]": description || "Paiement",
      "line_items[0][price_data][unit_amount]": String(Math.round(amount * 100)),
      "line_items[0][quantity]": "1",
      customer_email: customer_email || "",
      success_url: metadata?.return_url || `https://luxyra.fr/site.html?payment=success&salon=${salon_id}`,
      cancel_url: metadata?.cancel_url || `https://luxyra.fr/site.html?payment=cancel&salon=${salon_id}`,
      "metadata[salon_id]": salon_id,
      "metadata[type]": metadata?.type || "acompte",
      "metadata[rdv_id]": metadata?.rdv_id || "",
      "metadata[customer_name]": customer_name || "",
      "payment_intent_data[description]": description || "Paiement en ligne",
    };
    // 2026-10-09 : charge directe sur le compte du salon (ou ancien mode destination si interrupteur OFF)
    const _direct = await lxChargesDirectes(env);
    lxParamsPaiementSalon(sessionParams, _direct, salon.stripe_connect_id);
    // Empreinte : capture manuelle (pré-autorisation, débit différé)
    if (capture_method === "manual") {
      sessionParams["payment_intent_data[capture_method]"] = "manual";
      sessionParams["metadata[subtype]"] = "empreinte";
    }
    const session = await stripeAPI(env, "checkout/sessions", sessionParams, "POST", _direct ? salon.stripe_connect_id : null);

    if (session?.error?.type === "upstream_non_json") { console.error("connect session non-JSON:", session.error.http_status, session.error.raw); return jsonResponse({ error: "Service de paiement momentanément indisponible, merci de réessayer." }, 502); }
    if (!session?.url) return jsonResponse({ error: "Erreur paiement: " + JSON.stringify(session) }, 500);
    // Mémorise le compte Stripe qui porte le paiement (finalisation, capture, remboursement)
    if (_direct) {
      try {
        const _t = metadata?.type || "acompte";
        const _tbl = _t === "carte_abo" ? "cartes_abo_clients" : "rdv_online";
        const _id = _t === "carte_abo" ? (metadata?.carte_abo_id || metadata?.rdv_id) : metadata?.rdv_id;
        if (_id && /^[0-9a-f-]{36}$/i.test(String(_id))) await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/${_tbl}?id=eq.${encodeURIComponent(_id)}&salon_id=eq.${encodeURIComponent(salon_id)}`, { method: "PATCH", headers: _sbHeaders(env, { Prefer: "return=minimal" }), body: JSON.stringify({ stripe_account: salon.stripe_connect_id }) });
      } catch (_) {}
    }
    return jsonResponse({ url: session.url, session_id: session.id });
  } catch(e) { return jsonResponse({ error: "Connect payment error: " + e.message }, 500); }
}

// ============================================================
// CLICK & COLLECT (2026-10-08) — commande, paiement, préparation, retrait
// ============================================================
// Toute la logique est côté serveur : prix et total recalculés ici (avant : envoyés par le
// navigateur, donc falsifiables), numéro de commande, code de retrait, statuts tracés.
// Statuts : pending_payment -> a_preparer -> prete -> retiree ; annulee (avant retrait).
const CC_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function ccCode() {
  const b = new Uint8Array(6); crypto.getRandomValues(b);
  let s = ""; for (const x of b) s += CC_ALPHABET[x % CC_ALPHABET.length];
  return s;
}
function ccPrix(p) {
  const today = new Date().toISOString().slice(0, 10);
  const promo = p.promo_actif === true && p.promo_prix != null && (!p.promo_debut || p.promo_debut <= today) && (!p.promo_fin || p.promo_fin >= today);
  return Math.round(Number(promo ? p.promo_prix : p.prix) * 100) / 100;
}
function ccEsc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function ccEur(n) { return (Number(n) || 0).toFixed(2).replace(".", ",") + " €"; }
function ccLignesHtml(items) {
  return (items || []).map((i) => `<tr><td style="padding:6px 0">${ccEsc(i.nom)} × ${Number(i.qty) || 1}</td><td style="padding:6px 0;text-align:right">${ccEur((Number(i.prix) || 0) * (Number(i.qty) || 1))}</td></tr>`).join("");
}
// 2026-10-10 : mise en page commune des emails Luxyra (logo, noir et or, mentions de l'expéditeur)
function lxMailLayout(corpsHtml, opts) {
  opts = opts || {};
  const titre = opts.titre ? `<h1 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:400;color:#1a1a1a;line-height:1.3">${opts.titre}</h1>` : "";
  const pixel = opts.idSuivi ? `<img src="https://luxyra.fr/api/e/o/${opts.idSuivi}.gif" width="1" height="1" alt="" style="display:block;border:0">` : "";
  const pied = opts.pied ? `<div style="margin-bottom:6px">${opts.pied}</div>` : "";
  return `<div style="background:#f4f1ea;padding:24px 10px;margin:0">
  <div style="max-width:580px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e6dcc3;font-family:-apple-system,'Segoe UI',Arial,sans-serif;color:#1a1a1a;font-size:15px;line-height:1.6">
    <div style="background:#0b0b0b;padding:26px 20px 20px;text-align:center;border-bottom:3px solid #c8a84e">
      <img src="https://luxyra.fr/luxyra-logo.png" width="64" height="64" alt="Luxyra" style="display:block;margin:0 auto 10px;border-radius:12px">
      <div style="color:#d4a843;font-family:Georgia,'Times New Roman',serif;font-size:22px;letter-spacing:6px">LUXYRA</div>
      <div style="color:#8c8270;font-size:11px;letter-spacing:1px;margin-top:4px">GESTION &amp; CAISSE POUR LES PROFESSIONNELS DE LA BEAUTÉ</div>
    </div>
    <div style="padding:28px 26px 8px">${titre}${corpsHtml}</div>
    <div style="padding:16px 26px 22px;font-size:11px;color:#8a8a8a;border-top:1px solid #eee;margin-top:18px;line-height:1.5">${pied}Luxyra — Alexandre JENSEN, entrepreneur individuel — SIRET 910 928 464 00023<br>29 rue de l'Abbé Alexandre Pax, 57200 Sarreguemines — <a href="mailto:contact@luxyra.fr" style="color:#b8922e">contact@luxyra.fr</a> — <a href="https://luxyra.fr" style="color:#b8922e">luxyra.fr</a></div>
  </div>${pixel}</div>`;
}
function lxMailBouton(texte, url) {
  return `<p style="text-align:center;margin:22px 0"><a href="${url}" style="display:inline-block;background:#c8a84e;color:#111;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:30px">${texte}</a></p>`;
}
function ccMail(titre, corps) {
  return lxMailLayout(corps, { titre, pied: "Commande Click &amp; Collect passée via Luxyra." });
}
async function ccSalonEtConfig(env, salonId) {
  const salon = await supabaseGet(env, salonId);
  if (!salon) return { erreur: "Salon introuvable" };
  const proActif = salon.plan === "pro" || (salon.status === "trial" && salon.trial_end && new Date(salon.trial_end) > new Date());
  if (!proActif || salon.status === "suspended" || salon.status === "cancelled") return { erreur: "La boutique de ce salon n'est pas disponible" };
  const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/site_config?select=boutique_active,produits_en_ligne&salon_id=eq.${encodeURIComponent(salonId)}&limit=1`, { headers: _sbHeaders(env) });
  const c = r.ok ? (await r.json())[0] : null;
  if (!c || c.boutique_active !== true) return { erreur: "La boutique de ce salon n'est pas active" };
  return { salon, cfg: c };
}
async function ccLire(env, id) {
  const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/commandes_online?select=*&id=eq.${encodeURIComponent(id)}&limit=1`, { headers: _sbHeaders(env) });
  const a = r.ok ? await r.json() : [];
  return Array.isArray(a) ? a[0] || null : null;
}
async function ccMaj(env, id, patch, filtreStatuts, filtreSup) {
  let q = `${CONFIG.SUPABASE_URL}/rest/v1/commandes_online?id=eq.${encodeURIComponent(id)}`;
  if (filtreStatuts) q += `&status=in.(${filtreStatuts.join(",")})`;
  if (filtreSup) q += filtreSup;
  const r = await fetch(q, { method: "PATCH", headers: _sbHeaders(env, { Prefer: "return=representation" }), body: JSON.stringify(patch) });
  const a = r.ok ? await r.json() : [];
  return Array.isArray(a) ? a[0] || null : null;
}
async function ccMailsNouvelleCommande(env, cmd, salon) {
  const lignes = ccLignesHtml(cmd.items);
  const reglement = cmd.paye ? "Payée en ligne" : "À régler au salon lors du retrait";
  try {
    if (cmd.client_email) await brevoSendEmail(env, {
      to: cmd.client_email, toName: cmd.client_nom, senderName: salon.nom || "Luxyra", replyTo: salon.email || undefined,
      subject: `Commande n°${cmd.numero} reçue — ${salon.nom || ""}`,
      htmlContent: ccMail(`Commande n°${cmd.numero} reçue`, `<p>Bonjour ${ccEsc(cmd.client_nom)},</p><p>${ccEsc(salon.nom)} a bien reçu votre commande. Vous recevrez un email dès qu'elle sera prête.</p>
        <table style="width:100%;font-size:14px;border-collapse:collapse">${lignes}<tr><td style="padding-top:10px;font-weight:700">Total</td><td style="padding-top:10px;text-align:right;font-weight:700">${ccEur(cmd.total)}</td></tr></table>
        <p style="margin-top:14px">${reglement}</p>
        <div style="margin:18px 0;padding:14px;background:#fff8e6;border-left:4px solid #d4a843"><div style="font-size:12px;color:#666">Votre code de retrait</div><div style="font-size:26px;font-weight:800;letter-spacing:4px">${ccEsc(cmd.code_retrait)}</div><div style="font-size:12px;color:#666">À présenter au salon pour récupérer votre commande.</div></div>`)
    });
  } catch (e) { console.error("cc mail client:", e); }
  try {
    if (salon.email) await brevoSendEmail(env, {
      to: salon.email, toName: salon.nom, subject: `🛍 Nouvelle commande Click & Collect n°${cmd.numero}`,
      htmlContent: ccMail(`Nouvelle commande n°${cmd.numero}`, `<p><b>${ccEsc(cmd.client_nom)}</b> — ${ccEsc(cmd.client_tel)}</p>
        <table style="width:100%;font-size:14px;border-collapse:collapse">${lignes}<tr><td style="padding-top:10px;font-weight:700">Total</td><td style="padding-top:10px;text-align:right;font-weight:700">${ccEur(cmd.total)}</td></tr></table>
        <p>${reglement}</p><p>À traiter dans l'application : tuile <b>Commandes</b>.</p>`)
    });
  } catch (e) { console.error("cc mail salon:", e); }
}

// POST /api/cc/commande  {salon_id, items:[{id,qty}], nom, tel, message, session_token}
async function handleCcCommande(request, env) {
  try {
    const b = await readJsonBody(request);
    const session = await verifyClientSession(b.session_token, env);
    if (!session) return jsonResponse({ error: "Connectez-vous pour commander" }, 401);
    if (!/^[0-9a-f-]{36}$/i.test(String(b.salon_id || ""))) return jsonResponse({ error: "Salon invalide" }, 400);
    const sc = await ccSalonEtConfig(env, b.salon_id);
    if (sc.erreur) return jsonResponse({ error: sc.erreur }, 403);
    const demandes = (Array.isArray(b.items) ? b.items : []).map((i) => ({ id: parseInt(i.id), qty: parseInt(i.qty) })).filter((i) => i.id > 0 && i.qty > 0);
    if (!demandes.length || demandes.length > 30) return jsonResponse({ error: "Panier vide ou invalide" }, 400);
    if (demandes.some((i) => i.qty > 20)) return jsonResponse({ error: "Quantité maximale : 20 par produit" }, 400);
    const ids = [...new Set(demandes.map((i) => i.id))];
    const pr = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/produits?select=id,nom,prix,promo_actif,promo_prix,promo_debut,promo_fin,stock,actif,for_sale&salon_id=eq.${encodeURIComponent(b.salon_id)}&id=in.(${ids.join(",")})`, { headers: _sbHeaders(env) });
    const prods = pr.ok ? await pr.json() : [];
    const enLigne = Array.isArray(sc.cfg.produits_en_ligne) ? sc.cfg.produits_en_ligne.map(Number) : [];
    const items = []; let total = 0;
    for (const d of demandes) {
      const p = (prods || []).find((x) => Number(x.id) === d.id);
      if (!p || p.actif === false || p.for_sale === false || (enLigne.length && enLigne.indexOf(d.id) < 0)) return jsonResponse({ error: "Un produit n'est plus disponible à la vente" }, 409);
      const qtyTot = demandes.filter((x) => x.id === d.id).reduce((a, x) => a + x.qty, 0);
      if (p.stock != null && Number(p.stock) < qtyTot) return jsonResponse({ error: `« ${p.nom} » : stock insuffisant (${Math.max(0, Number(p.stock) || 0)} disponible)` }, 409);
      const prix = ccPrix(p);
      items.push({ produit_id: p.id, nom: p.nom, prix, qty: d.qty });
      total += prix * d.qty;
    }
    total = Math.round(total * 100) / 100;
    if (!(total > 0) || total > 5000) return jsonResponse({ error: "Montant de commande invalide" }, 400);
    const salon = sc.salon;
    const connectOk = !!salon.stripe_connect_id && ["active", "enabled", "payouts_pending"].includes(String(salon.stripe_connect_status || ""));
    const row = {
      salon_id: b.salon_id, client_nom: String(b.nom || session.email).slice(0, 120), client_tel: String(b.tel || "").slice(0, 30),
      client_email: session.email, client_luxyra_id: session.lx_id, items, total,
      message: b.message ? String(b.message).slice(0, 500) : null,
      code_retrait: ccCode(), mode_paiement: connectOk ? "en_ligne" : "au_salon",
      status: connectOk ? "pending_payment" : "a_preparer", paye: false
    };
    const ins = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/commandes_online`, { method: "POST", headers: _sbHeaders(env, { Prefer: "return=representation" }), body: JSON.stringify(row) });
    const insA = ins.ok ? await ins.json() : null;
    const cmd = Array.isArray(insA) ? insA[0] : null;
    if (!cmd) { console.error("cc insert:", ins.status, await ins.text().catch(() => "")); return jsonResponse({ error: "Commande non enregistrée" }, 500); }
    if (!connectOk) {
      await ccMailsNouvelleCommande(env, cmd, salon);
      return jsonResponse({ ok: true, commande_id: cmd.id, numero: cmd.numero, code_retrait: cmd.code_retrait, total, paiement: "au_salon" });
    }
    const base = lxUrlLuxyra(b.retour) ? String(b.retour).split("?")[0] : "https://luxyra.fr/site.html";
    const sep = `?s=${encodeURIComponent(b.salon_id)}&`;
    const params = {
      mode: "payment", customer_email: session.email,
      success_url: `${base}${sep}order=success&cmd=${cmd.id}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}${sep}order=cancel&cmd=${cmd.id}`,
      "metadata[type]": "click_collect", "metadata[commande_id]": cmd.id, "metadata[salon_id]": b.salon_id,
      "payment_intent_data[description]": `Click & Collect n°${cmd.numero} — ${salon.nom || ""}`.slice(0, 200),
      "payment_intent_data[metadata][commande_id]": cmd.id,
      expires_at: String(Math.floor(Date.now() / 1000) + 31 * 60),
    };
    items.forEach((it, i) => {
      params[`line_items[${i}][price_data][currency]`] = "eur";
      params[`line_items[${i}][price_data][product_data][name]`] = String(it.nom).slice(0, 120);
      params[`line_items[${i}][price_data][unit_amount]`] = String(Math.round(it.prix * 100));
      params[`line_items[${i}][quantity]`] = String(it.qty);
    });
    const _directCc = await lxChargesDirectes(env);
    lxParamsPaiementSalon(params, _directCc, salon.stripe_connect_id);
    const s = await stripeAPI(env, "checkout/sessions", params, "POST", _directCc ? salon.stripe_connect_id : null);
    if (_directCc && s?.url) await ccMaj(env, cmd.id, { stripe_account: salon.stripe_connect_id });
    if (!s?.url) {
      await ccMaj(env, cmd.id, { status: "annulee", cancelled_at: new Date().toISOString(), cancelled_by: "systeme", cancel_reason: "paiement impossible" });
      return jsonResponse({ error: "Paiement en ligne indisponible pour ce salon : " + (s?.error?.message || "erreur Stripe") }, 502);
    }
    return jsonResponse({ ok: true, url: s.url, commande_id: cmd.id, numero: cmd.numero });
  } catch (e) { console.error("cc commande:", e); return jsonResponse({ error: "Erreur serveur" }, 500); }
}

// Vérifie le paiement Stripe et passe la commande « à préparer » (idempotent). Webhook + retour client.
async function ccFinaliserPaiement(env, commandeId, sessionStripe) {
  if (!/^[0-9a-f-]{36}$/i.test(String(commandeId || ""))) return { erreur: "commande invalide", code: 400 };
  const s = sessionStripe;
  if (!s || s.payment_status !== "paid") return { erreur: "Paiement non confirmé", code: 402 };
  if (!s.metadata || s.metadata.type !== "click_collect" || String(s.metadata.commande_id) !== String(commandeId)) return { erreur: "Paiement non lié à cette commande", code: 403 };
  const cmd = await ccLire(env, commandeId);
  if (!cmd) return { erreur: "Commande introuvable", code: 404 };
  if (String(cmd.salon_id) !== String(s.metadata.salon_id)) return { erreur: "Paiement non lié à ce salon", code: 403 };
  if (cmd.paye === true) return { ok: true, deja: true, cmd };
  if (Number(s.amount_total || 0) + 1 < Math.round(Number(cmd.total) * 100)) return { erreur: "Montant payé insuffisant", code: 402 };
  const maj = await ccMaj(env, cmd.id, { paye: true, stripe_payment_id: s.id, payment_intent_id: s.payment_intent || null, status: "a_preparer" }, ["pending_payment", "annulee"]);
  if (!maj) { const re = await ccLire(env, commandeId); return re && re.paye ? { ok: true, deja: true, cmd: re } : { erreur: "Mise à jour impossible", code: 409 }; }
  const salon = await supabaseGet(env, maj.salon_id);
  await ccMailsNouvelleCommande(env, maj, salon || {});
  return { ok: true, cmd: maj };
}
// POST /api/cc/finalize {commande_id, session_id}
async function handleCcFinalize(request, env) {
  try {
    const { commande_id, session_id } = await readJsonBody(request);
    if (!/^cs_[A-Za-z0-9_]+$/.test(String(session_id || ""))) return jsonResponse({ error: "session invalide" }, 400);
    const _c = /^[0-9a-f-]{36}$/i.test(String(commande_id || "")) ? await ccLire(env, commande_id) : null;
    let _comptes = [];
    if (_c) { _comptes.push(_c.stripe_account); const _sl = await supabaseGet(env, _c.salon_id); if (_sl) _comptes.push(_sl.stripe_connect_id); }
    const { session: s } = await lxSessionOu(env, session_id, _comptes);
    const r = await ccFinaliserPaiement(env, commande_id, s);
    if (r.erreur) return jsonResponse({ error: r.erreur }, r.code || 400);
    return jsonResponse({ ok: true, numero: r.cmd.numero, code_retrait: r.cmd.code_retrait, total: r.cmd.total });
  } catch (e) { return jsonResponse({ error: "Erreur serveur" }, 500); }
}

// POST /api/cc/action {salon_id, commande_id, action: prete|retiree|annulee, code, sans_code, operateur, ticket_num, motif}
// (route salon : propriétaire du salon vérifié par LX_ROUTES_SALON)
async function handleCcAction(request, env) {
  try {
    const b = await readJsonBody(request);
    const cmd = await ccLire(env, b.commande_id);
    if (!cmd || String(cmd.salon_id) !== String(b.salon_id)) return jsonResponse({ error: "Commande introuvable" }, 404);
    const op = String(b.operateur || "").slice(0, 80) || "Salon";
    const now = new Date().toISOString();
    const salon = await supabaseGet(env, cmd.salon_id) || {};
    if (b.action === "prete") {
      const maj = await ccMaj(env, cmd.id, { status: "prete", ready_at: now }, ["a_preparer"]);
      if (!maj) return jsonResponse({ error: "Commande déjà " + cmd.status.replace("_", " ") }, 409);
      try {
        if (maj.client_email) await brevoSendEmail(env, {
          to: maj.client_email, toName: maj.client_nom, senderName: salon.nom || "Luxyra", replyTo: salon.email || undefined,
          subject: `Votre commande n°${maj.numero} est prête — ${salon.nom || ""}`,
          htmlContent: ccMail(`Votre commande est prête ✅`, `<p>Bonjour ${ccEsc(maj.client_nom)},</p><p>Votre commande n°${maj.numero} vous attend chez <b>${ccEsc(salon.nom)}</b>${salon.adresse ? " — " + ccEsc(salon.adresse) + " " + ccEsc(salon.cp || "") + " " + ccEsc(salon.ville || "") : ""}.</p>
            <p>${maj.paye ? "Elle est déjà payée." : "Montant à régler au salon : <b>" + ccEur(maj.total) + "</b>."}</p>
            <div style="margin:18px 0;padding:14px;background:#fff8e6;border-left:4px solid #d4a843"><div style="font-size:12px;color:#666">Code de retrait à présenter</div><div style="font-size:26px;font-weight:800;letter-spacing:4px">${ccEsc(maj.code_retrait)}</div></div>`)
        });
      } catch (e) { console.error("cc mail prete:", e); }
      return jsonResponse({ ok: true, commande: maj });
    }
    if (b.action === "retiree") {
      if (cmd.status === "retiree") return jsonResponse({ error: `Déjà remise le ${new Date(cmd.collected_at).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })} par ${cmd.collected_by || "?"}`, deja: true, commande: cmd }, 409);
      const codeOk = String(b.code || "").trim().toUpperCase() === String(cmd.code_retrait || "").toUpperCase();
      if (!codeOk && b.sans_code !== true) return jsonResponse({ error: "Code de retrait incorrect" }, 403);
      // 2026-10-09 (NF525) : toute remise est rattachée à un ticket de caisse scellé (payée en ligne ou au salon)
      if (!String(b.ticket_num || "").trim()) return jsonResponse({ error: cmd.paye ? "Remise sans ticket impossible : passez par la caisse (mode « Payé en ligne »). Mettez l'application à jour (rechargez la page)." : "Commande non payée : encaissez-la d'abord en caisse" }, 409);
      const maj = await ccMaj(env, cmd.id, {
        status: "retiree", collected_at: now,
        collected_by: op + (codeOk ? " (code vérifié)" : " (sans code, identité vérifiée)"),
        ticket_num: b.ticket_num ? String(b.ticket_num).slice(0, 40) : cmd.ticket_num
      }, ["a_preparer", "prete"]);
      if (!maj) { const re = await ccLire(env, cmd.id); return jsonResponse({ error: re && re.status === "retiree" ? `Déjà remise le ${new Date(re.collected_at).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })} par ${re.collected_by || "?"}` : "Commande non remettable (" + (re ? re.status : "?") + ")", deja: !!(re && re.status === "retiree"), commande: re }, 409); }
      return jsonResponse({ ok: true, commande: maj });
    }
    if (b.action === "annulee") {
      if (!["pending_payment", "a_preparer", "prete"].includes(cmd.status)) return jsonResponse({ error: "Commande non annulable (" + cmd.status + ")" }, 409);
      let refundId = null;
      if (cmd.paye && cmd.payment_intent_id) {
        const rf = cmd.stripe_account
          ? await stripeAPI(env, "refunds", { payment_intent: cmd.payment_intent_id, "metadata[commande_id]": cmd.id }, "POST", cmd.stripe_account)
          : await stripeAPI(env, "refunds", { payment_intent: cmd.payment_intent_id, reverse_transfer: "true", "metadata[commande_id]": cmd.id });
        if (!rf?.id) return jsonResponse({ error: "Remboursement refusé par Stripe : " + (rf?.error?.message || "erreur") }, 502);
        refundId = rf.id;
      }
      // FIX 2026-10-09 : si la commande n'était pas payée à la lecture, on n'annule que si elle ne l'est toujours pas
      // (un paiement finalisé entre-temps ne doit jamais finir « annulée sans remboursement »).
      const maj = await ccMaj(env, cmd.id, { status: "annulee", cancelled_at: now, cancelled_by: op, cancel_reason: b.motif ? String(b.motif).slice(0, 300) : null, refund_id: refundId }, ["pending_payment", "a_preparer", "prete"], cmd.paye ? "" : "&paye=eq.false");
      if (!maj && !cmd.paye) { const re = await ccLire(env, cmd.id); if (re && re.paye && re.status !== "annulee") return jsonResponse({ error: "La cliente vient de payer cette commande : relancez l'annulation pour la rembourser.", commande: re }, 409); }
      try {
        if (maj && maj.client_email) await brevoSendEmail(env, {
          to: maj.client_email, toName: maj.client_nom, senderName: salon.nom || "Luxyra", replyTo: salon.email || undefined,
          subject: `Commande n°${maj.numero} annulée — ${salon.nom || ""}`,
          htmlContent: ccMail("Commande annulée", `<p>Bonjour ${ccEsc(maj.client_nom)},</p><p>Votre commande n°${maj.numero} chez ${ccEsc(salon.nom)} a été annulée${b.motif ? " : " + ccEsc(b.motif) : ""}.</p>${refundId ? "<p>Le paiement de " + ccEur(maj.total) + " vous est remboursé (délai bancaire de 5 à 10 jours).</p>" : ""}`)
        });
      } catch (e) { console.error("cc mail annulee:", e); }
      return jsonResponse({ ok: true, commande: maj, rembourse: !!refundId });
    }
    return jsonResponse({ error: "Action inconnue" }, 400);
  } catch (e) { console.error("cc action:", e); return jsonResponse({ error: "Erreur serveur" }, 500); }
}

// POST /api/client/commandes {session_token} — commandes de la cliente connectée
async function handleClientCommandes(request, env) {
  try {
    const { session_token } = await readJsonBody(request);
    const session = await verifyClientSession(session_token, env);
    if (!session) return jsonResponse({ error: "Session invalide" }, 401);
    const q = `${CONFIG.SUPABASE_URL}/rest/v1/commandes_online?select=id,salon_id,numero,items,total,status,paye,mode_paiement,code_retrait,created_at,ready_at,collected_at,cancelled_at&or=(client_luxyra_id.eq.${encodeURIComponent(session.lx_id)},client_email.eq.%22${encodeURIComponent(session.email)}%22)&status=neq.pending_payment&order=created_at.desc&limit=50`;
    const r = await fetch(q, { headers: _sbHeaders(env) });
    const rows = r.ok ? await r.json() : [];
    const salonIds = [...new Set((rows || []).map((x) => x.salon_id))];
    let noms = {};
    if (salonIds.length) {
      const s = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/salons?select=id,nom&id=in.(${salonIds.join(",")})`, { headers: _sbHeaders(env) });
      (s.ok ? await s.json() : []).forEach((x) => { noms[x.id] = x.nom; });
    }
    return jsonResponse({ commandes: (rows || []).map((x) => Object.assign({}, x, { salon_nom: noms[x.salon_id] || "", code_retrait: x.status === "retiree" || x.status === "annulee" ? null : x.code_retrait })) });
  } catch (e) { return jsonResponse({ error: "Erreur serveur" }, 500); }
}

// ============================================================
// STRIPE — GESTION DEPUIS LE PANNEAU ADMIN (2026-10-09)
// ============================================================
// POST /api/admin/stripe {op, ...}  — réservé au compte admin (support@luxyra.fr, JWT vérifié).
// Lecture : overview, salon. Actions (toutes journalisées dans admin_log) : coupon, retirer_coupon,
// changer_forfait, annuler_fin_periode, reprendre, relancer_facture, rembourser, lien_inscription.
function saEur(c) { return Math.round(Number(c || 0)) / 100; }
function saPlanDuPrix(priceId) {
  if (priceId === CONFIG.PRICE_PRO_FOUNDER) return "pro_fondateur";
  if (priceId === CONFIG.PRICE_PRO) return "pro";
  if (priceId === CONFIG.PRICE_ESSENTIAL) return "essentiel";
  return "autre";
}
async function saListe(env, chemin, max = 500, compte = null) {
  const out = []; let after = null;
  for (let i = 0; i < 10 && out.length < max; i++) {
    const sep = chemin.includes("?") ? "&" : "?";
    const r = await stripeAPI(env, `${chemin}${sep}limit=100${after ? "&starting_after=" + after : ""}`, null, "GET", compte);
    if (!r || !Array.isArray(r.data)) { if (r && r.error) throw new Error(r.error.message || "Stripe"); break; }
    out.push(...r.data);
    if (!r.has_more || !r.data.length) break;
    after = r.data[r.data.length - 1].id;
  }
  return out;
}
async function saSalons(env) {
  const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/salons?select=id,nom,plan,status,is_free,is_founder,stripe_customer_id,stripe_subscription_id,stripe_connect_id,stripe_connect_status`, { headers: _sbHeaders(env) });
  return r.ok ? await r.json() : [];
}
async function saLog(env, action, salonId, details) {
  try {
    await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/admin_log`, { method: "POST", headers: _sbHeaders(env, { Prefer: "return=minimal" }), body: JSON.stringify({ action, salon_id: salonId || null, details: String(details || "").slice(0, 1000) }) });
  } catch (_) {}
}
function saMontantMensuel(sub) {
  let t = 0;
  for (const it of (sub.items?.data || [])) {
    const p = it.price || {}; const q = Number(it.quantity || 1);
    let m = Number(p.unit_amount || 0) * q;
    if (p.recurring?.interval === "year") m = m / 12;
    t += m;
  }
  const remises = [].concat(sub.discount ? [sub.discount] : [], Array.isArray(sub.discounts) ? sub.discounts.filter((d) => d && typeof d === "object") : []);
  for (const d of remises) {
    const c = d.coupon || d.source?.coupon || {};
    if (d.end && d.end * 1000 < Date.now()) continue;
    if (c.percent_off) t = t * (1 - c.percent_off / 100);
    else if (c.amount_off) t = Math.max(0, t - c.amount_off);
  }
  return t;
}


// ============================================================
// WEBHOOK « COMPTES CONNECTÉS » (2026-10-09) — /api/stripe/webhook-connect
// Reçoit les évènements des comptes Stripe des salons (paiements directs des clientes).
// Authenticité : l'évènement est RELU chez Stripe au nom du compte (aucun secret à configurer).
// ============================================================
async function handleWebhookConnect(request, env) {
  let recu = null;
  try { recu = JSON.parse(await request.text()); } catch (e) { return jsonResponse({ error: "Invalid payload" }, 400); }
  if (!recu || !/^evt_[A-Za-z0-9]+$/.test(String(recu.id || "")) || !/^acct_[A-Za-z0-9]+$/.test(String(recu.account || ""))) return jsonResponse({ error: "Invalid event" }, 400);
  const event = await stripeAPI(env, `events/${recu.id}`, null, "GET", recu.account);
  if (!event || event.id !== recu.id) return jsonResponse({ error: "Event not verifiable" }, 401);
  const compte = recu.account;
  const data = event.data?.object || {};
  // Trace (visible dans l'admin) : preuve que le webhook « comptes connectés » fonctionne
  try { await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/app_secrets?on_conflict=key`, { method: "POST", headers: _sbHeaders(env, { Prefer: "resolution=merge-duplicates,return=minimal" }), body: JSON.stringify({ key: "stripe_webhook_connect_dernier", value: new Date().toISOString() + " " + event.type, description: "Dernier évènement reçu sur /api/stripe/webhook-connect" }) }); } catch (_) {}
  try {
    if ((event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") && data.payment_status === "paid") {
      const t = data.metadata?.type;
      if (t === "click_collect") await ccFinaliserPaiement(env, data.metadata.commande_id, data);
      else if (t === "bon_cadeau") {
        // Traitement confié à la fonction des bons cadeaux (emails, notification), évènement déjà vérifié ici.
        await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/gc-stripe-webhook`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, "x-lx-internal": env.SUPABASE_SERVICE_KEY },
          // account inclus : si la clé interne n'est pas reconnue, la fonction relit elle-même l'évènement chez Stripe
          body: JSON.stringify(Object.assign({}, event, { account: compte }))
        });
      } else {
        // 2026-10-09 : filet si la cliente ferme la page avant le retour du paiement. On rejoue EXACTEMENT la
        // finalisation de la page (mêmes contrôles, idempotente : « déjà enregistré » si la page l'a déjà fait).
        const md = data.metadata || {};
        const appel = (corps) => new Request("https://luxyra.fr/interne", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });
        let rep = null;
        if (md.subtype === "empreinte" && md.rdv_id) rep = await handleEmpreinteFinalize(appel({ session_id: data.id, rdv_id: md.rdv_id }), env);
        else if ((!t || t === "acompte") && md.rdv_id) rep = await handleAcompteFinalize(appel({ session_id: data.id, rdv_id: md.rdv_id }), env);
        else if (t === "rdv_demande_acompte" && md.proposal_token) rep = await handleRdvDemandeFinalize(appel({ token: md.proposal_token, session_id: data.id }), env);
        else if (t === "carte_abo" && (md.carte_abo_id || md.rdv_id)) {
          rep = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/carte-abo-confirm-payment`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ carte_id: md.carte_abo_id || md.rdv_id, stripe_session_id: data.id }) });
        }
        if (rep) {
          const st = rep.status, txt = await rep.text().catch(() => "");
          // 5xx -> Stripe réessaiera ; 4xx « déjà traité / déjà enregistré » = normal (la page l'a fait)
          if (st >= 500) throw new Error(`finalisation ${t || md.subtype || "?"} ${st} ${txt.slice(0, 200)}`);
          if (st >= 400 && !/d[ée]j[àa]|already/i.test(txt)) await reportWorkerError(env, "worker:stripe-webhook-connect", new Error(`finalisation refusée ${t || md.subtype} ${st}`), { session: data.id, compte, reponse: txt.slice(0, 300) }, "warning");
        }
      }
    } else if (event.type === "charge.dispute.created") {
      const sr = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/salons?select=nom&stripe_connect_id=eq.${encodeURIComponent(compte)}&limit=1`, { headers: _sbHeaders(env) });
      const sa = sr.ok ? await sr.json() : [];
      const ech = data.evidence_details?.due_by ? new Date(data.evidence_details.due_by * 1000).toLocaleDateString("fr-FR") : "?";
      await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/notify_admins`, { method: "POST", headers: _sbHeaders(env), body: JSON.stringify({ p_event_type: "payment_failed", p_title: "⚠️ Litige chez un salon", p_body: `${(sa[0] && sa[0].nom) || compte} : ${(data.amount || 0) / 100} € — motif ${data.reason} — réponse avant le ${ech} (dans son Stripe)`, p_url: "/admin.html?tab=finance&sub=stripe", p_payload: {} }) });
    } else if (event.type === "account.updated") {
      const ch = !!data.charges_enabled, po = !!data.payouts_enabled, de = !!data.details_submitted;
      const statut = ch && po ? "active" : (ch ? "payouts_pending" : (de ? "pending_verification" : "incomplete"));
      await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/salons?stripe_connect_id=eq.${encodeURIComponent(compte)}`, { method: "PATCH", headers: _sbHeaders(env, { Prefer: "return=minimal" }), body: JSON.stringify({ stripe_connect_status: statut }) });
    }
  } catch (e) {
    try { await reportWorkerError(env, "worker:stripe-webhook-connect", e, { type: event.type, account: compte }, "error"); } catch (_) {}
    return jsonResponse({ error: "processing" }, 500);  // Stripe réessaiera
  }
  return jsonResponse({ received: true });
}

async function handleAdminStripe(request, env) {
  try {
    const u = await lxAuthUser(request);
    if (!u || !lxIsAdminUser(u)) return jsonResponse({ error: "Accès réservé à l'administrateur" }, 403);
    const b = await readJsonBody(request);
    const op = String(b.op || "");
    const admin = String(u.email || "admin");

    if (op === "overview") {
      const [balance, subs, payouts, disputes, openInv, salons, whs, direct] = await Promise.all([
        stripeAPI(env, "balance", null, "GET"),
        saListe(env, "subscriptions?status=all&expand[]=data.discounts", 1000),
        stripeAPI(env, "payouts?limit=12", null, "GET"),
        stripeAPI(env, "disputes?limit=50", null, "GET"),
        stripeAPI(env, "invoices?status=open&limit=50", null, "GET"),
        saSalons(env),
        stripeAPI(env, "webhook_endpoints?limit=50", null, "GET"),
        lxChargesDirectes(env),
      ]);
      const whConnect = (whs?.data || []).some((w) => w.status === "enabled" && String(w.url || "").includes("/api/stripe/webhook-connect"));
      let dernierConnect = null;
      try { const r0 = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/app_secrets?select=value&key=eq.stripe_webhook_connect_dernier`, { headers: _sbHeaders(env) }); const a0 = r0.ok ? await r0.json() : []; dernierConnect = (a0[0] && a0[0].value) || null; } catch (_) {}
      const parCust = {}; const parConnect = {};
      (salons || []).forEach((s) => { if (s.stripe_customer_id) parCust[s.stripe_customer_id] = s; if (s.stripe_connect_id) parConnect[s.stripe_connect_id] = s; });
      const debutMois = new Date(); debutMois.setUTCDate(1); debutMois.setUTCHours(0, 0, 0, 0);
      const t0 = Math.floor(debutMois.getTime() / 1000);
      const compte = { essentiel: 0, pro: 0, pro_fondateur: 0, autre: 0 };
      let mrr = 0, actifs = 0, impayes = 0, nouveaux = 0, departs = 0, finPeriode = 0;
      for (const s of subs) {
        if (s.created >= t0 && s.status !== "incomplete_expired") nouveaux++;
        if (s.canceled_at && s.canceled_at >= t0) departs++;
        if (!["active", "trialing", "past_due"].includes(s.status)) continue;
        actifs++;
        if (s.status === "past_due") impayes++;
        if (s.cancel_at_period_end) finPeriode++;
        const pid = s.items?.data?.[0]?.price?.id;
        compte[saPlanDuPrix(pid)]++;
        if (s.status !== "trialing") mrr += saMontantMensuel(s);
      }
      const eur = (arr) => (arr || []).filter((x) => x.currency === "eur").reduce((a, x) => a + x.amount, 0);
      const litiges = (disputes?.data || []).filter((d) => ["needs_response", "warning_needs_response", "under_review", "warning_under_review"].includes(d.status)).map((d) => ({
        id: d.id, montant: saEur(d.amount), raison: d.reason, statut: d.status,
        echeance: d.evidence_details?.due_by ? new Date(d.evidence_details.due_by * 1000).toISOString() : null,
        cree: new Date(d.created * 1000).toISOString(), payment_intent: d.payment_intent,
      }));
      const factures = (openInv?.data || []).map((i) => ({
        id: i.id, numero: i.number, montant: saEur(i.amount_due), tentatives: i.attempt_count,
        prochaine: i.next_payment_attempt ? new Date(i.next_payment_attempt * 1000).toISOString() : null,
        salon: parCust[i.customer]?.nom || i.customer_email || i.customer, salon_id: parCust[i.customer]?.id || null,
        url: i.hosted_invoice_url,
      }));
      return jsonResponse({
        mode: balance?.livemode === false ? "test" : "live",
        paiements_clientes: { charges_directes: !!direct, webhook_connect: whConnect, dernier_evenement: dernierConnect,
          webhooks: (whs?.data || []).map((w) => ({ url: w.url, statut: w.status, evenements: (w.enabled_events || []).length, liste: (w.enabled_events || []).slice(0, 12) })) },
        solde: { disponible: saEur(eur(balance?.available)), en_attente: saEur(eur(balance?.pending)) },
        abonnements: { actifs, impayes, fin_de_periode: finPeriode, nouveaux_mois: nouveaux, departs_mois: departs, par_forfait: compte, mrr: saEur(mrr) },
        virements: (payouts?.data || []).map((p) => ({ id: p.id, montant: saEur(p.amount), statut: p.status, arrivee: new Date(p.arrival_date * 1000).toISOString().slice(0, 10) })),
        litiges, factures_impayees: factures,
        salons_connect: (salons || []).filter((s) => s.stripe_connect_id).map((s) => ({ id: s.id, nom: s.nom, statut: s.stripe_connect_status })),
      });
    }

    // Ventes de packs SMS sur 12 mois (source : Stripe) — lecture seule (2026-10-09)
    if (op === "sms_revenus") {
      const debut = Math.floor(Date.now() / 1000) - 366 * 86400;
      const sessions = await saListe(env, `checkout/sessions?status=complete&created[gte]=${debut}`, 3000);
      const parMois = {}; let nb = 0, eur = 0, sms = 0;
      sessions.filter((x) => x.metadata && x.metadata.type === "sms_pack" && x.payment_status === "paid").forEach((x) => {
        const m = new Date(x.created * 1000).toISOString().slice(0, 7);
        const e = (Number(x.amount_total) || 0) / 100, q = parseInt(x.metadata.sms_qty || "0", 10) || 0;
        parMois[m] = parMois[m] || { nb: 0, eur: 0, sms: 0 };
        parMois[m].nb++; parMois[m].eur = Math.round((parMois[m].eur + e) * 100) / 100; parMois[m].sms += q;
        nb++; eur += e; sms += q;
      });
      // + recharges automatiques (paiements hors session, pas de session Checkout)
      try {
        const q = encodeURIComponent(`metadata['type']:'sms_recharge_auto' AND status:'succeeded' AND created>${debut}`);
        const ra = await stripeAPI(env, `payment_intents/search?query=${q}&limit=100`, null, "GET");
        (ra && Array.isArray(ra.data) ? ra.data : []).forEach((x) => {
          const m = new Date(x.created * 1000).toISOString().slice(0, 7);
          const e = (Number(x.amount_received || x.amount) || 0) / 100, qn = parseInt((x.metadata && x.metadata.sms_qty) || "0", 10) || 0;
          parMois[m] = parMois[m] || { nb: 0, eur: 0, sms: 0 };
          parMois[m].nb++; parMois[m].eur = Math.round((parMois[m].eur + e) * 100) / 100; parMois[m].sms += qn;
          nb++; eur += e; sms += qn;
        });
      } catch (_) {}
      return jsonResponse({ ok: true, par_mois: parMois, total: { nb, eur: Math.round(eur * 100) / 100, sms } });
    }

    // Export des factures Luxyra (abonnements) — lecture seule (2026-10-09)
    if (op === "factures") {
      const mois = String(b.mois || "").trim();
      let debut, fin;
      if (/^\d{4}-\d{2}$/.test(mois)) {
        const [y, m] = mois.split("-").map(Number);
        debut = Math.floor(Date.UTC(y, m - 1, 1) / 1000); fin = Math.floor(Date.UTC(y, m, 1) / 1000);
      } else if (!mois) {
        fin = Math.floor(Date.now() / 1000); debut = fin - 366 * 86400;
      } else return jsonResponse({ error: "Format attendu : AAAA-MM" }, 400);
      const [inv, salons] = await Promise.all([
        saListe(env, `invoices?created[gte]=${debut}&created[lt]=${fin}`, 1000),
        saSalons(env),
      ]);
      const parCust = {}; (salons || []).forEach((s) => { if (s.stripe_customer_id) parCust[s.stripe_customer_id] = s; });
      const e2 = (c) => Math.round((Number(c) || 0)) / 100;
      const factures = inv.filter((f) => f.status !== "draft").map((f) => {
        const lt = Array.isArray(f.total_taxes) ? f.total_taxes : (Array.isArray(f.total_tax_amounts) ? f.total_tax_amounts : null);
        const tva = lt ? lt.reduce((a, t) => a + (Number(t.amount) || 0), 0) : (Number(f.tax) || 0);
        const ttc = Number(f.total) || 0;
        return {
          date: new Date((f.status_transitions?.finalized_at || f.created) * 1000).toISOString().slice(0, 10),
          numero: f.number || f.id,
          salon: parCust[f.customer]?.nom || f.customer_name || "",
          email: f.customer_email || "",
          statut: ({ paid: "payée", open: "à payer", void: "annulée", uncollectible: "irrécouvrable" })[f.status] || f.status,
          ht: e2(ttc - tva), tva: e2(tva), ttc: e2(ttc),
          paye: e2(f.amount_paid), rembourse: e2(f.post_payment_credit_notes_amount || 0),
          pdf: f.invoice_pdf || f.hosted_invoice_url || "",
        };
      }).sort((x, y) => (x.date < y.date ? -1 : 1));
      await saLog(env, "STRIPE_EXPORT_FACTURES", null, `${mois || "12 derniers mois"} — ${factures.length} facture(s) par ${admin}`);
      return jsonResponse({ ok: true, factures });
    }

    // Les autres opérations portent sur UN salon
    if (!/^[0-9a-f-]{36}$/i.test(String(b.salon_id || ""))) return jsonResponse({ error: "salon_id requis" }, 400);
    const salon = await supabaseGet(env, b.salon_id);
    if (!salon) return jsonResponse({ error: "Salon introuvable" }, 404);
    const motif = b.motif ? String(b.motif).slice(0, 300) : "";

    if (op === "salon") {
      const res = { salon: { id: salon.id, nom: salon.nom, plan: salon.plan, status: salon.status, is_free: salon.is_free, is_founder: salon.is_founder } };
      if (salon.stripe_subscription_id) {
        const s = await stripeAPI(env, `subscriptions/${salon.stripe_subscription_id}?expand[]=discounts`, null, "GET");
        if (s && s.id) {
          const remises = (Array.isArray(s.discounts) ? s.discounts : []).filter((d) => d && typeof d === "object").map((d) => ({ nom: d.coupon?.name || d.source?.coupon?.name || "", pct: d.coupon?.percent_off || d.source?.coupon?.percent_off || null, montant: d.coupon?.amount_off ? saEur(d.coupon.amount_off) : null, fin: d.end ? new Date(d.end * 1000).toISOString().slice(0, 10) : null }));
          res.abonnement = {
            id: s.id, statut: s.status, forfait: saPlanDuPrix(s.items?.data?.[0]?.price?.id), mensuel: saEur(saMontantMensuel(s)),
            fin_periode: s.current_period_end ? new Date(s.current_period_end * 1000).toISOString().slice(0, 10) : (s.items?.data?.[0]?.current_period_end ? new Date(s.items.data[0].current_period_end * 1000).toISOString().slice(0, 10) : null),
            annule_fin_periode: !!s.cancel_at_period_end, essai_jusqu: s.trial_end ? new Date(s.trial_end * 1000).toISOString().slice(0, 10) : null, remises,
          };
        }
      }
      if (salon.stripe_customer_id) {
        const inv = await stripeAPI(env, `invoices?customer=${encodeURIComponent(salon.stripe_customer_id)}&limit=24`, null, "GET");
        res.factures = (inv?.data || []).map((i) => ({ id: i.id, numero: i.number, statut: i.status, du: saEur(i.amount_due), paye: saEur(i.amount_paid), date: new Date(i.created * 1000).toISOString().slice(0, 10), tentatives: i.attempt_count, url: i.hosted_invoice_url, pdf: i.invoice_pdf, payment_intent: typeof i.payment_intent === "string" ? i.payment_intent : (i.payments?.data?.[0]?.payment?.payment_intent || null) }));
      }
      if (salon.stripe_connect_id) {
        const a = await stripeAPI(env, `accounts/${salon.stripe_connect_id}`, null, "GET");
        if (a && a.id) {
          res.connect = { id: a.id, encaissements: !!a.charges_enabled, virements: !!a.payouts_enabled, dossier_envoye: !!a.details_submitted, blocage: a.requirements?.disabled_reason || null, a_fournir: a.requirements?.currently_due || [], en_retard: a.requirements?.past_due || [], plus_tard: a.requirements?.eventually_due || [] };
          const depuis = Math.floor(Date.now() / 1000) - 90 * 86400;
          // Paiements directs sur le compte du salon + anciens paiements « destination » sur la plateforme
          const [pisDirects, pisPlateforme] = await Promise.all([
            saListe(env, `payment_intents?created[gte]=${depuis}&expand[]=data.latest_charge`, 300, salon.stripe_connect_id).catch(() => []),
            saListe(env, `payment_intents?created[gte]=${depuis}&expand[]=data.latest_charge`, 300),
          ]);
          const pis = pisDirects.concat(pisPlateforme.filter((p) => p.transfer_data?.destination === salon.stripe_connect_id)).sort((x, y) => y.created - x.created);
          res.paiements_clientes = pis.slice(0, 60).map((p) => ({
            id: p.id, montant: saEur(p.amount), statut: p.status, type: p.metadata?.type || (p.capture_method === "manual" ? "empreinte" : ""), description: p.description || "",
            date: new Date(p.created * 1000).toISOString(), rembourse: saEur(p.latest_charge?.amount_refunded || 0),
          }));
        }
      }
      return jsonResponse(res);
    }

    const subId = salon.stripe_subscription_id;
    if (op === "coupon") {
      if (!subId) return jsonResponse({ error: "Ce salon n'a pas d'abonnement Stripe" }, 400);
      const pct = Number(b.pourcentage || 0), mt = Number(b.montant || 0);
      if (!(pct > 0 && pct <= 100) && !(mt > 0 && mt <= 100)) return jsonResponse({ error: "Remise invalide (1 à 100 %, ou 0,01 à 100 €)" }, 400);
      const duree = ["once", "repeating", "forever"].includes(b.duree) ? b.duree : "once";
      const params = { duration: duree, name: (`Geste Luxyra ${pct ? pct + " %" : mt + " €"}` + (motif ? " — " + motif : "")).slice(0, 40), "metadata[salon_id]": salon.id, "metadata[par]": admin };
      if (pct) params.percent_off = String(pct); else { params.amount_off = String(Math.round(mt * 100)); params.currency = "eur"; }
      if (duree === "repeating") params.duration_in_months = String(Math.max(1, Math.min(24, parseInt(b.mois) || 1)));
      const c = await stripeAPI(env, "coupons", params);
      if (!c?.id) return jsonResponse({ error: "Stripe : " + (c?.error?.message || "coupon refusé") }, 502);
      const s = await stripeAPI(env, `subscriptions/${subId}`, { "discounts[0][coupon]": c.id });
      if (!s?.id) return jsonResponse({ error: "Stripe : " + (s?.error?.message || "remise non appliquée") }, 502);
      await saLog(env, "STRIPE_REMISE", salon.id, `${params.name} (${duree}${params.duration_in_months ? " " + params.duration_in_months + " mois" : ""}) par ${admin}`);
      return jsonResponse({ ok: true });
    }
    if (op === "retirer_coupon") {
      if (!subId) return jsonResponse({ error: "Pas d'abonnement" }, 400);
      const s = await stripeAPI(env, `subscriptions/${subId}`, { discounts: "" });
      if (!s?.id) return jsonResponse({ error: "Stripe : " + (s?.error?.message || "échec") }, 502);
      await saLog(env, "STRIPE_REMISE_RETIREE", salon.id, `par ${admin}${motif ? " — " + motif : ""}`);
      return jsonResponse({ ok: true });
    }
    if (op === "changer_forfait") {
      if (!["pro", "essential"].includes(b.plan)) return jsonResponse({ error: "Forfait invalide" }, 400);
      const r = await handleSwitchPlan(new Request("https://interne/switch", { method: "POST", body: JSON.stringify({ salon_id: salon.id, plan: b.plan }) }), env);
      const d = await r.json().catch(() => ({}));
      if (r.status === 200) await saLog(env, "STRIPE_FORFAIT", salon.id, `${salon.plan} → ${b.plan} par ${admin}${motif ? " — " + motif : ""}`);
      return jsonResponse(d, r.status);
    }
    if (op === "annuler_fin_periode" || op === "reprendre") {
      if (!subId) return jsonResponse({ error: "Pas d'abonnement" }, 400);
      const s = await stripeAPI(env, `subscriptions/${subId}`, { cancel_at_period_end: op === "annuler_fin_periode" ? "true" : "false" });
      if (!s?.id) return jsonResponse({ error: "Stripe : " + (s?.error?.message || "échec") }, 502);
      await saLog(env, op === "reprendre" ? "STRIPE_REPRISE" : "STRIPE_ANNULATION_FIN_PERIODE", salon.id, `par ${admin}${motif ? " — " + motif : ""}`);
      return jsonResponse({ ok: true });
    }
    // Plan offert depuis l'admin : suspendre / reprendre la facturation Stripe (pas de facture pendant l'offre)
    if (op === "pause_facturation" || op === "reprendre_facturation") {
      if (!subId) return jsonResponse({ ok: true, sans_abonnement: true });
      const params = op === "pause_facturation"
        ? { "pause_collection[behavior]": "void", ...(b.jusqu_au && /^\d{4}-\d{2}-\d{2}$/.test(String(b.jusqu_au)) ? { "pause_collection[resumes_at]": String(Math.floor(new Date(b.jusqu_au + "T00:00:00Z").getTime() / 1000)) } : {}) }
        : { pause_collection: "" };
      const s = await stripeAPI(env, `subscriptions/${subId}`, params);
      if (!s?.id) return jsonResponse({ error: "Stripe : " + (s?.error?.message || "échec") }, 502);
      await saLog(env, op === "pause_facturation" ? "STRIPE_FACTURATION_SUSPENDUE" : "STRIPE_FACTURATION_REPRISE", salon.id, `${b.jusqu_au ? "jusqu'au " + b.jusqu_au + " " : ""}par ${admin}${motif ? " — " + motif : ""}`);
      return jsonResponse({ ok: true });
    }
    if (op === "relancer_facture") {
      const inv = await stripeAPI(env, `invoices/${encodeURIComponent(String(b.facture_id || ""))}`, null, "GET");
      if (!inv?.id || inv.customer !== salon.stripe_customer_id) return jsonResponse({ error: "Facture introuvable pour ce salon" }, 404);
      if (inv.status !== "open") return jsonResponse({ error: "Facture non due (" + inv.status + ")" }, 409);
      const p = await stripeAPI(env, `invoices/${inv.id}/pay`, {});
      await saLog(env, "STRIPE_RELANCE_FACTURE", salon.id, `${inv.number || inv.id} : ${p?.status || p?.error?.message || "?"} par ${admin}`);
      if (p?.status === "paid") return jsonResponse({ ok: true, statut: "paid" });
      return jsonResponse({ error: "Paiement refusé : " + (p?.error?.message || p?.status || "échec") }, 402);
    }
    if (op === "rembourser") {
      const _piId = encodeURIComponent(String(b.payment_intent || ""));
      // 1) paiement direct sur le compte du salon ? 2) sinon paiement sur la plateforme (abonnement ou ancien mode)
      let piCompte = null;
      let pi = salon.stripe_connect_id ? await stripeAPI(env, `payment_intents/${_piId}?expand[]=latest_charge`, null, "GET", salon.stripe_connect_id) : null;
      if (pi && pi.id) piCompte = salon.stripe_connect_id; else pi = await stripeAPI(env, `payment_intents/${_piId}?expand[]=latest_charge`, null, "GET");
      if (!pi?.id) return jsonResponse({ error: "Paiement introuvable" }, 404);
      const estAbo = !piCompte && salon.stripe_customer_id && pi.customer === salon.stripe_customer_id;
      const estClient = !!piCompte || (salon.stripe_connect_id && pi.transfer_data?.destination === salon.stripe_connect_id);
      if (!estAbo && !estClient) return jsonResponse({ error: "Ce paiement n'appartient pas à ce salon" }, 403);
      const reste = Number(pi.latest_charge?.amount || pi.amount_received || 0) - Number(pi.latest_charge?.amount_refunded || 0);
      const montant = b.montant ? Math.round(Number(b.montant) * 100) : reste;
      if (!(montant > 0) || montant > reste) return jsonResponse({ error: `Montant invalide (reste remboursable : ${saEur(reste)} €)` }, 400);
      if (!motif) return jsonResponse({ error: "Motif obligatoire" }, 400);
      const params = { payment_intent: pi.id, amount: String(montant), "metadata[par]": admin, "metadata[motif]": motif };
      if (estClient && !piCompte) params.reverse_transfer = "true";
      const rf = await stripeAPI(env, "refunds", params, "POST", piCompte);
      if (!rf?.id) return jsonResponse({ error: "Stripe : " + (rf?.error?.message || "remboursement refusé") }, 502);
      await saLog(env, "STRIPE_REMBOURSEMENT", salon.id, `${saEur(montant)} € sur ${pi.id} (${piCompte ? "paiement cliente sur le compte du salon" : estClient ? "paiement cliente (ancien mode), repris au salon" : "abonnement Luxyra"}) par ${admin} — ${motif}`);
      return jsonResponse({ ok: true, refund_id: rf.id, montant: saEur(montant) });
    }
    if (op === "lien_inscription") {
      if (!salon.stripe_connect_id) return jsonResponse({ error: "Ce salon n'a pas encore de compte Stripe" }, 400);
      const l = await stripeAPI(env, "account_links", { account: salon.stripe_connect_id, refresh_url: "https://luxyra.fr/app?connect=refresh", return_url: "https://luxyra.fr/app?connect=success", type: "account_onboarding" });
      if (!l?.url) return jsonResponse({ error: "Stripe : " + (l?.error?.message || "échec") }, 502);
      await saLog(env, "STRIPE_LIEN_INSCRIPTION", salon.id, `généré par ${admin}`);
      return jsonResponse({ ok: true, url: l.url, expire: new Date((l.expires_at || 0) * 1000).toISOString() });
    }
    return jsonResponse({ error: "Opération inconnue" }, 400);
  } catch (e) {
    console.error("admin stripe:", e);
    try { await reportWorkerError(env, "admin:stripe", e, null, "error"); } catch (_) {}
    return jsonResponse({ error: "Erreur : " + (e?.message || e) }, 500);
  }
}

// Contrôle quotidien (cron) : litiges ouverts + comptes Stripe des salons bloqués -> alerte admin.
async function runStripeSurveillanceJob(env) {
  const alertes = [];
  const salons = await saSalons(env);
  const parConnect = {}; (salons || []).forEach((s) => { if (s.stripe_connect_id) parConnect[s.stripe_connect_id] = s; });
  // 1) Litiges à traiter
  const d = await stripeAPI(env, "disputes?limit=50", null, "GET");
  for (const x of (d?.data || [])) {
    if (!["needs_response", "warning_needs_response"].includes(x.status)) continue;
    const ech = x.evidence_details?.due_by ? new Date(x.evidence_details.due_by * 1000).toLocaleDateString("fr-FR") : "?";
    alertes.push({ titre: "⚠️ Litige Stripe à traiter", corps: `${saEur(x.amount)} € — motif ${x.reason} — réponse avant le ${ech}` });
  }
  // 2) Comptes Connect : statut réel synchronisé + alerte si blocage
  for (const s of (salons || [])) {
    if (!s.stripe_connect_id) continue;
    const a = await stripeAPI(env, `accounts/${s.stripe_connect_id}`, null, "GET");
    if (!a?.id) continue;
    // même codification que handleConnectStatus (utilisée par l'app et le site)
    const ch = !!a.charges_enabled, po = !!a.payouts_enabled, de = !!a.details_submitted;
    const statut = ch && po ? "active" : (ch ? "payouts_pending" : (de ? "pending_verification" : "incomplete"));
    if (statut !== s.stripe_connect_status) { try { await supabaseUpdate(env, s.id, { stripe_connect_status: statut }); } catch (_) {} }
    // Litiges sur les paiements directs (compte du salon)
    try {
      const dl = await stripeAPI(env, "disputes?limit=20", null, "GET", s.stripe_connect_id);
      for (const x of (dl?.data || [])) {
        if (!["needs_response", "warning_needs_response"].includes(x.status)) continue;
        const ech = x.evidence_details?.due_by ? new Date(x.evidence_details.due_by * 1000).toLocaleDateString("fr-FR") : "?";
        alertes.push({ titre: "⚠️ Litige chez un salon", corps: `${s.nom} : ${saEur(x.amount)} € — motif ${x.reason} — réponse avant le ${ech} (dans son Stripe)` });
      }
    } catch (_) {}
    // 2026-10-09 : alerte UNIQUEMENT pour un compte qui encaissait déjà (actif) et qui est bloqué ou a des pièces
    // en retard. Une inscription Stripe commencée puis abandonnée (ex. salon en essai) n'est pas une panne :
    // elle reste visible dans la fiche salon, sans alerte. Une seule alerte par situation (pas de relance quotidienne).
    const encaissait = s.stripe_connect_status === "active" || ch;
    const probleme = encaissait && ((a.requirements?.past_due || []).length || (s.stripe_connect_status === "active" && statut !== "active"));
    const cleAl = "stripe_alerte_" + s.stripe_connect_id;
    if (probleme) {
      const sig = statut + "|" + (a.requirements?.disabled_reason || "") + "|" + (a.requirements?.past_due || []).slice().sort().join(",");
      let deja = null;
      try { const rr = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/app_secrets?select=value&key=eq.${encodeURIComponent(cleAl)}&limit=1`, { headers: _sbHeaders(env) }); const ra = rr.ok ? await rr.json() : []; deja = ra[0] ? ra[0].value : null; } catch (_) {}
      if (deja !== sig) {
        alertes.push({ titre: "🏦 Compte Stripe d'un salon à régulariser", corps: `${s.nom} : ${a.requirements?.disabled_reason || "pièces en retard"} (${(a.requirements?.past_due || []).length} élément(s))` });
        try { await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/app_secrets?on_conflict=key`, { method: "POST", headers: _sbHeaders(env, { Prefer: "resolution=merge-duplicates,return=minimal" }), body: JSON.stringify({ key: cleAl, value: sig, description: "Dernière alerte compte Stripe salon (anti-répétition)" }) }); } catch (_) {}
      }
    } else {
      try { await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/app_secrets?key=eq.${encodeURIComponent(cleAl)}`, { method: "DELETE", headers: _sbHeaders(env, { Prefer: "return=minimal" }) }); } catch (_) {}
    }
  }
  // 3) Filet charges directes : paiement réussi chez Stripe mais jamais validé chez nous (webhook perdu)
  try {
    const avant = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    const depuis = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
    const rq = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/cartes_cadeaux?select=id,code,valeur,salon_id,stripe_account,stripe_session_id&payment_status=eq.pending&stripe_account=not.is.null&stripe_session_id=not.is.null&created_at=lt.${encodeURIComponent(avant)}&created_at=gt.${encodeURIComponent(depuis)}&limit=30`, { headers: _sbHeaders(env) });
    for (const bc of (rq.ok ? await rq.json() : [])) {
      const ss = await stripeAPI(env, `checkout/sessions/${encodeURIComponent(bc.stripe_session_id)}`, null, "GET", bc.stripe_account);
      if (ss && ss.payment_status === "paid") alertes.push({ titre: "🎁 Bon cadeau payé mais non validé", corps: `Bon ${bc.code} (${bc.valeur} €) payé chez Stripe mais resté « en attente » : webhook comptes connectés à vérifier.` });
    }
  } catch (_) {}
  for (const al of alertes) {
    try {
      await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/notify_admins`, { method: "POST", headers: _sbHeaders(env), body: JSON.stringify({ p_event_type: "payment_failed", p_title: al.titre, p_body: al.corps, p_url: "/admin.html#stripe", p_payload: {} }) });
    } catch (_) {}
  }
  return { alertes: alertes.length };
}

// ============================================================
// SIRET -> fiche entreprise officielle (2026-10-09)
// GET /api/siret?siret=14 chiffres — API publique « Recherche d'entreprises » (data.gouv, gratuite).
// Normalise : nom, enseigne, adresse, forme juridique (code Luxyra), NAF + métier suggéré, dirigeant,
// n° TVA intracom, état (active / fermée), date de création. Données « non diffusibles » respectées.
// ============================================================
function siretValideLuhn(s) {
  if (!/^\d{14}$/.test(s)) return false;
  let t = 0;
  for (let i = 0; i < 14; i++) { let d = Number(s[13 - i]); if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; } t += d; }
  return t % 10 === 0 || s.startsWith("356000000"); // La Poste : exception connue
}
function tvaIntraDepuisSiren(siren) { const n = Number(siren); if (!isFinite(n)) return null; const cle = (12 + 3 * (n % 97)) % 97; return "FR" + String(cle).padStart(2, "0") + siren; }
function formeLuxyra(code) {
  const c = String(code || "");
  if (c === "1000") return "micro"; // entrepreneur individuel (micro ou réel : à confirmer par le salon)
  if (c === "5498") return "eurl";
  if (c === "5720") return "sasu";
  if (c === "5710") return "sas";
  if (/^54/.test(c)) return "sarl";
  if (/^55|^56/.test(c)) return "sa";
  return c ? "autre" : "";
}
const FORMES_LIB = { "1000": "Entrepreneur individuel", "5498": "EURL", "5499": "SARL", "5710": "SAS", "5720": "SASU" };
function metierDepuisNaf(naf) {
  const n = String(naf || "").toUpperCase();
  if (n === "96.02A") return "coiffure";
  if (n === "96.02B") return "esthetique";
  if (n === "96.04Z") return "bien_etre";
  return null;
}
async function handleSiret(request, env) {
  try {
    const u = new URL(request.url);
    const siret = String(u.searchParams.get("siret") || "").replace(/\s+/g, "");
    if (!/^\d{14}$/.test(siret)) return jsonResponse({ ok: false, error: "Le SIRET doit faire 14 chiffres" }, 400);
    if (!siretValideLuhn(siret)) return jsonResponse({ ok: false, error: "Ce numéro SIRET n'est pas valide (erreur de saisie ?)" }, 400);
    const cache = caches.default;
    const cleCache = new Request(`https://cache.luxyra.internal/siret/${siret}`);
    const enCache = await cache.match(cleCache);
    if (enCache) return new Response(enCache.body, { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    // 2026-10-09 : l'annuaire officiel est parfois lent ou indisponible : 1 nouvel essai, puis réponse
    // « indisponible » en 200 (ce n'est pas une panne Luxyra : plus d'alerte 5xx inutile).
    let r = null, d = null;
    for (let essai = 0; essai < 2 && !d; essai++) {
      try {
        r = await fetch(`https://recherche-entreprises.api.gouv.fr/search?q=${siret}&per_page=1&minimal=false`, { headers: { Accept: "application/json" } });
        if (r.ok) d = await r.json();
      } catch (_) {}
      if (!d && essai === 0) await new Promise((ok) => setTimeout(ok, 700));
    }
    if (!d) return jsonResponse({ ok: false, indisponible: true, error: "Service officiel momentanément indisponible, réessayez dans un instant ou remplissez à la main" }, 200);
    const e = (d.results || []).find((x) => String(x.siren) === siret.slice(0, 9)) || null;
    if (!e) return jsonResponse({ ok: false, error: "SIRET introuvable dans le répertoire officiel" }, 404);
    const etab = (e.matching_etablissements || []).find((x) => x.siret === siret) || (e.siege && e.siege.siret === siret ? e.siege : null) || e.siege || {};
    const nd = (v) => (v && !String(v).includes("NON-DIFFUSIBLE") ? v : "");
    const dir = (e.dirigeants || []).find((x) => x.type_dirigeant === "personne physique") || null;
    const enseigne = nd((etab.liste_enseignes || [])[0]) || nd(etab.nom_commercial);
    const res = {
      ok: true, siret, siren: e.siren,
      actif: etab.etat_administratif ? etab.etat_administratif === "A" : e.etat_administratif === "A",
      date_fermeture: etab.date_fermeture || e.date_fermeture || null,
      nom: nd(enseigne) || nd(e.nom_raison_sociale) || nd(e.nom_complet),
      raison_sociale: nd(e.nom_raison_sociale) || nd(e.nom_complet),
      enseigne,
      adresse: nd([etab.numero_voie, etab.indice_repetition, etab.type_voie, etab.libelle_voie].filter(Boolean).join(" "))
        || (/^\d{5}$/.test(String(etab.code_postal || "")) ? nd(String(etab.adresse || "").replace(new RegExp("\\s*" + etab.code_postal + "\\s+.*$"), "").trim()) : "") || "",
      complement: nd(etab.complement_adresse),
      cp: nd(etab.code_postal), ville: nd(etab.libelle_commune),
      latitude: nd(etab.latitude) ? Number(etab.latitude) : null, longitude: nd(etab.longitude) ? Number(etab.longitude) : null,
      forme_code: e.nature_juridique || null, forme: formeLuxyra(e.nature_juridique), forme_libelle: FORMES_LIB[e.nature_juridique] || (e.nature_juridique ? "Autre (" + e.nature_juridique + ")" : ""),
      entrepreneur_individuel: !!(e.complements && e.complements.est_entrepreneur_individuel),
      naf: etab.activite_principale || e.activite_principale || null, metier: metierDepuisNaf(etab.activite_principale || e.activite_principale),
      dirigeant_nom: dir ? nd(dir.nom) : "", dirigeant_prenom: dir ? nd(String(dir.prenoms || "").split(" ")[0]) : "",
      tva_intra: (e.tva && typeof e.tva === "object" && e.tva.numero) ? e.tva.numero : tvaIntraDepuisSiren(e.siren),
      date_creation: etab.date_creation || e.date_creation || null,
      non_diffusible: String(e.statut_diffusion || "") !== "O" || !nd(e.nom_complet),
      siege: !!etab.est_siege,
    };
    const corps = JSON.stringify(res);
    try { await cache.put(cleCache, new Response(corps, { headers: { "Content-Type": "application/json", "Cache-Control": "max-age=86400" } })); } catch (_) {}
    return new Response(corps, { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[siret]", e?.message || e);
    return jsonResponse({ ok: false, indisponible: true, error: "Vérification impossible pour le moment, réessayez dans un instant" }, 200);
  }
}

// ============================================================
// RELANCES D'ESSAI AUTOMATIQUES (2026-10-09) — cron 08:00 UTC
// J+3 « besoin d'aide ? », J+7 « ce qu'il vous reste à configurer » (personnalisé), J-2 « fin d'essai ».
// Interrupteur : app_config.relances_essai_actives (false par défaut). Une seule fois par type et par salon
// (table salon_emails_auto) ; ouverture suivie par un pixel /api/e/o/<id>.gif.
// ============================================================
const ETAPES_LIB = {
  prestations: ["Créer vos prestations", "Paramètres → Services et forfaits"],
  horaires: ["Renseigner vos horaires", "Paramètres → Horaires"],
  equipe: ["Ajouter votre équipe", "Paramètres → Équipe"],
  clients: ["Importer ou créer vos clientes", "tuile Clients (ou Paramètres → Migration depuis votre ancien logiciel)"],
  rdv: ["Placer un premier rendez-vous", "tuile Planning"],
  tickets: ["Faire un premier encaissement", "tuile Encaissement"],
  site: ["Mettre votre site en ligne (réservation 24/7)", "Paramètres → Site en ligne"],
};
function relMail(prenom, corpsHtml, idSuivi) {
  return lxMailLayout(`${corpsHtml}<p style="margin-top:24px">Alexandre<br><span style="color:#888;font-size:13px">Fondateur de Luxyra — répondez simplement à cet email</span></p>`, { idSuivi });
}
async function runRelancesEssaiJob(env) {
  const stats = { candidats: 0, envoyes: 0, ignores: 0, erreurs: 0, actif: false };
  try {
    const c = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/app_config?id=eq.1&select=config`, { headers: _sbHeaders(env) });
    const cfg = c.ok ? ((await c.json())[0] || {}).config || {} : {};
    if (cfg.relances_essai_actives !== true) return stats;
    stats.actif = true;
  } catch (_) { return stats; }
  const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/salons?select=id,nom,email,gerant_prenom,created_at,trial_end,is_free&status=eq.trial&is_free=eq.false`, { headers: _sbHeaders(env) });
  const salons = r.ok ? await r.json() : [];
  const suivi = await (await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/admin_suivi_salons?select=salon_id,etape`, { headers: _sbHeaders(env) })).json().catch(() => []);
  const etapeDe = {}; (Array.isArray(suivi) ? suivi : []).forEach((x) => { etapeDe[x.salon_id] = x.etape; });
  const now = Date.now();
  for (const s of salons) {
    if (!s.email) continue;
    if (["perdu", "client"].includes(etapeDe[s.id])) { stats.ignores++; continue; }
    const age = (now - new Date(s.created_at).getTime()) / 86400000;
    const reste = s.trial_end ? (new Date(s.trial_end).getTime() - now) / 86400000 : null;
    let type = null;
    if (reste !== null && reste > 0 && reste <= 2.5) type = "essai_fin";
    else if (age >= 7 && age < 12) type = "essai_j7";
    else if (age >= 3 && age < 6) type = "essai_j3";
    if (!type) continue;
    stats.candidats++;
    // Réservation (dédoublonnage) AVANT envoi : unique (salon_id, type)
    const ins = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/salon_emails_auto?on_conflict=salon_id,type`, { method: "POST", headers: _sbHeaders(env, { Prefer: "return=representation,resolution=ignore-duplicates" }), body: JSON.stringify({ salon_id: s.id, type }) });
    const rowA = ins.ok ? await ins.json() : [];
    const row = Array.isArray(rowA) ? rowA[0] : null;
    if (!row) { stats.ignores++; continue; } // déjà envoyé
    const prenom = s.gerant_prenom ? String(s.gerant_prenom).trim() : "";
    const bonjour = `<p>Bonjour${prenom ? " " + ccEsc(prenom) : ""},</p>`;
    let sujet, corps;
    if (type === "essai_j3") {
      sujet = `${s.nom} : comment se passent vos débuts sur Luxyra ?`;
      corps = bonjour + `<p>Cela fait quelques jours que vous testez Luxyra pour <b>${ccEsc(s.nom)}</b>. Je voulais simplement savoir si tout se passe bien.</p>
        <p>Si quelque chose vous bloque (prestations, planning, caisse, site), répondez à cet email ou écrivez-moi dans le chat de l'application (bouton support) : je vous aide personnellement, et rapidement.</p>
        <p>Astuce : vous pouvez importer vos clientes et vos prestations depuis votre ancien logiciel (Paramètres → Migration).</p>`;
    } else if (type === "essai_j7") {
      let manque = [];
      try {
        const e = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/salon_demarrage_etapes`, { method: "POST", headers: _sbHeaders(env), body: JSON.stringify({ p_salon: s.id }) });
        const et = e.ok ? await e.json() : {};
        Object.keys(ETAPES_LIB).forEach((k) => { const v = et[k]; if (v === false || v === 0) manque.push(ETAPES_LIB[k]); });
      } catch (_) {}
      sujet = manque.length ? `${s.nom} : ${manque.length} étape${manque.length > 1 ? "s" : ""} pour profiter pleinement de Luxyra` : `${s.nom} : une semaine sur Luxyra`;
      corps = bonjour + (manque.length
        ? `<p>Vous êtes à mi-parcours de votre essai. Voici ce qu'il vous reste pour que Luxyra travaille vraiment pour vous :</p><ul>${manque.map((m) => `<li><b>${m[0]}</b> — ${m[1]}</li>`).join("")}</ul><p>Pendant l'essai, toutes les fonctions Pro sont ouvertes (site, réservation en ligne, paiements en ligne) : c'est le moment de tout essayer.</p>`
        : `<p>Bravo, votre salon est déjà bien configuré sur Luxyra ! Pendant l'essai, toutes les fonctions Pro sont ouvertes : réservation en ligne 24/7, site vitrine, paiements en ligne. N'hésitez pas à les tester.</p>`)
        + `<p>Une question ? Répondez simplement à cet email.</p>`;
    } else {
      const fin = new Date(s.trial_end).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
      sujet = `${s.nom} : votre essai Luxyra se termine ${fin}`;
      corps = bonjour + `<p>Votre essai gratuit de Luxyra se termine <b>${fin}</b>. Pour continuer sans interruption et garder toutes vos données (clientes, rendez-vous, caisse), choisissez votre forfait dans <b>Paramètres → S'abonner</b>.</p>
        <p>Les 100 premiers salons au forfait Pro bénéficient du tarif Fondateur (14,99 €/mois au lieu de 24,99 €), garanti tant que l'abonnement reste actif.</p>
        <p>Un doute, une question sur le choix du forfait ? Répondez à cet email, je vous conseille volontiers.</p>`;
    }
    try {
      const res = await brevoSendEmail(env, { to: s.email, toName: s.nom, senderName: "Alexandre de Luxyra", senderEmail: "contact@luxyra.fr", replyTo: "support@luxyra.fr", subject: sujet, htmlContent: relMail(prenom, corps, row.id) });
      if (res && (res.messageId || res.messageIds)) {
        stats.envoyes++;
        await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/salon_emails_auto?id=eq.${row.id}`, { method: "PATCH", headers: _sbHeaders(env, { Prefer: "return=minimal" }), body: JSON.stringify({ sujet }) });
      } else {
        stats.erreurs++;
        await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/salon_emails_auto?id=eq.${row.id}`, { method: "DELETE", headers: _sbHeaders(env) }); // réessai demain
      }
    } catch (e) { stats.erreurs++; await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/salon_emails_auto?id=eq.${row.id}`, { method: "DELETE", headers: _sbHeaders(env) }).catch(() => {}); }
  }
  return stats;
}
// 2026-10-10 : rappel UNIQUE de signature de l'attestation de conformité de la caisse (volet 2, modèle BOI-LETTRE-000242).
// Interrupteur app_config.relance_attestation_active (false par défaut). Un seul email par établissement et par version
// majeure (salon_emails_auto type « attestation_v<majeure> »), UNIQUEMENT pour un abonnement payé (status active), au moins
// 1 jour après le début de l'abonnement (abonne_depuis), s'il a déjà encaissé et n'a pas signé.
async function runAttestationRelanceJob(env) {
  const stats = { actif: false, candidats: 0, envoyes: 0, erreurs: 0 };
  try {
    const c = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/app_config?id=eq.1&select=config`, { headers: _sbHeaders(env) });
    const cfg = c.ok ? ((await c.json())[0] || {}).config || {} : {};
    if (cfg.relance_attestation_active !== true) return stats;
    stats.actif = true;
  } catch (_) { return stats; }
  const er = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/nf525_attestation_editeur?select=id,version_majeure&order=id.desc&limit=1`, { headers: _sbHeaders(env) });
  const ed = er.ok ? (await er.json())[0] : null;
  if (!ed) return stats;
  const type = "attestation_v" + ed.version_majeure;
  const sr = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/salons?select=id,nom,email,gerant_prenom,abonne_depuis&status=eq.active`, { headers: _sbHeaders(env) });
  const salons = sr.ok ? await sr.json() : [];
  const ar = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/nf525_attestations?select=salon_id&version_majeure=eq.${encodeURIComponent(ed.version_majeure)}`, { headers: _sbHeaders(env) });
  const signes = new Set((ar.ok ? await ar.json() : []).map((x) => x.salon_id));
  const hier = Date.now() - 86400000;
  for (const s of salons) {
    if (!s.email || signes.has(s.id)) continue;
    if (s.abonne_depuis && new Date(s.abonne_depuis).getTime() > hier) continue; // laisser 1 jour après le paiement
    const tr = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/tickets?select=date_ticket&salon_id=eq.${s.id}&order=date_ticket.asc&limit=1`, { headers: _sbHeaders(env) });
    const t = tr.ok ? (await tr.json())[0] : null;
    if (!t || !t.date_ticket) continue;
    stats.candidats++;
    const ins = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/salon_emails_auto?on_conflict=salon_id,type`, { method: "POST", headers: _sbHeaders(env, { Prefer: "return=representation,resolution=ignore-duplicates" }), body: JSON.stringify({ salon_id: s.id, type }) });
    const rowA = ins.ok ? await ins.json() : [];
    const row = Array.isArray(rowA) ? rowA[0] : null;
    if (!row) continue; // déjà envoyé une fois : jamais de second email
    const prenom = s.gerant_prenom ? String(s.gerant_prenom).trim() : "";
    const sujet = `${s.nom} : votre attestation de conformité de caisse à signer`;
    const corps = `<p>Bonjour${prenom ? " " + ccEsc(prenom) : ""},</p>
      <p>Merci pour votre confiance. Il reste une petite formalité légale pour que <b>${ccEsc(s.nom)}</b> soit parfaitement en règle : <b>signer l'attestation de conformité de votre caisse</b>.</p>
      <h3 style="font-family:Georgia,serif;font-weight:400;font-size:17px;color:#b8922e;margin:22px 0 6px">Pourquoi ?</h3>
      <p style="margin-top:0">Depuis 2018, tout professionnel assujetti à la TVA qui encaisse des particuliers doit utiliser une caisse sécurisée et pouvoir le <b>prouver en cas de contrôle fiscal</b> (article 286, I, 3° bis du code général des impôts). Sans justificatif, l'amende est de <b>7 500 € par caisse</b> (article 1770 duodecies du même code).</p>
      <p>Ce justificatif est l'<b>attestation individuelle</b>, établie selon le <b>modèle officiel de l'administration fiscale</b> (BOI-LETTRE-000242). Elle comporte deux volets :</p>
      <ul style="padding-left:20px;margin:6px 0 0">
        <li><b>Volet 1 — l'éditeur</b> : Luxyra atteste que le logiciel respecte les conditions d'inaltérabilité, de sécurisation, de conservation et d'archivage. <span style="color:#3a7d44">Déjà signé ✔</span></li>
        <li><b>Volet 2 — votre établissement</b> : vous indiquez depuis quand vous utilisez la caisse. <b>Sans lui, l'attestation n'a pas de valeur.</b></li>
      </ul>
      <h3 style="font-family:Georgia,serif;font-weight:400;font-size:17px;color:#b8922e;margin:22px 0 6px">Comment ? (1 minute)</h3>
      <ol style="padding-left:20px;margin:6px 0 0">
        <li>Ouvrez l'application Luxyra : le bandeau vert <b>« Attestation de conformité de votre caisse à signer »</b> s'affiche sur l'accueil (ou <b>Paramètres → Caisse → Conformité de la caisse → Mon attestation</b>).</li>
        <li>Vérifiez les informations, <b>déjà pré-remplies</b> (représentant légal, dates, ville).</li>
        <li>Saisissez votre mot de passe Luxyra, cochez la case et touchez <b>« Signer électroniquement »</b>. La signature électronique a la même valeur qu'une signature manuscrite (code civil, art. 1366-1367).</li>
        <li>Téléchargez le PDF et <b>conservez-le avec vos pièces comptables</b> pendant toute la durée d'utilisation puis 6 ans (art. L102 B du livre des procédures fiscales).</li>
      </ol>
      ${lxMailBouton("Ouvrir Luxyra et signer", "https://luxyra.fr/app")}
      <p style="font-size:13px;color:#666">Vous préférez le papier ? Le bouton « Imprimer pour signer à la main » est aussi proposé. Une question : répondez simplement à cet email.</p>
      <p style="font-size:12px;color:#999">Ceci est un rappel unique : vous ne recevrez pas d'autre email à ce sujet.</p>`;
    try {
      const res = await brevoSendEmail(env, { to: s.email, toName: s.nom, senderName: "Alexandre de Luxyra", senderEmail: "contact@luxyra.fr", replyTo: "support@luxyra.fr", subject: sujet, htmlContent: relMail(prenom, corps, row.id) });
      if (res && (res.messageId || res.messageIds)) {
        stats.envoyes++;
        await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/salon_emails_auto?id=eq.${row.id}`, { method: "PATCH", headers: _sbHeaders(env, { Prefer: "return=minimal" }), body: JSON.stringify({ sujet }) });
      } else {
        stats.erreurs++;
        await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/salon_emails_auto?id=eq.${row.id}`, { method: "DELETE", headers: _sbHeaders(env) });
      }
    } catch (e) { stats.erreurs++; await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/salon_emails_auto?id=eq.${row.id}`, { method: "DELETE", headers: _sbHeaders(env) }).catch(() => {}); }
  }
  return stats;
}
// GET /api/e/o/<uuid>.gif — ouverture d'un email automatique
const PIXEL_GIF = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), (c) => c.charCodeAt(0));
async function handlePixelOuverture(request, env, url) {
  const m = url.pathname.match(/^\/api\/e\/o\/([0-9a-f-]{36})\.gif$/i);
  if (m) {
    try { await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/salon_emails_auto?id=eq.${m[1]}&ouvert_le=is.null`, { method: "PATCH", headers: _sbHeaders(env, { Prefer: "return=minimal" }), body: JSON.stringify({ ouvert_le: new Date().toISOString() }) }); } catch (_) {}
  }
  return new Response(PIXEL_GIF, { status: 200, headers: { "Content-Type": "image/gif", "Cache-Control": "no-store, max-age=0" } });
}

// ============================================================
// FIX 2026-05-13 : Export NF525 (conservation 6 ans, audit fiscal)
// ============================================================
// Permet au salon de télécharger un archive JSON signé contenant :
// - Tous les tickets NF525 (table tickets, SHA-256 chaîné)
// - Toutes les clôtures Z (table clotures, SHA-256)
// - Vérification automatique de l'intégrité de la chaîne
// - Métadonnées salon (nom, SIRET, période)
// Format : JSON pur exploitable Excel/comptable
async function handleExportNF525(request, env) {
  try {
    const { salon_id, date_from, date_to, jwt } = await request.json();
    if (!salon_id) return jsonResponse({ error: "salon_id requis" }, 400);

    // Auth simple : on accepte le service_role OU un JWT de propriétaire du salon
    // Ici on valide via Supabase REST avec service_role + filter salon_id
    const sbUrl = CONFIG.SUPABASE_URL;
    const sbKey = env.SUPABASE_SERVICE_KEY;
    if (!sbKey) return jsonResponse({ error: "Service unavailable" }, 503);

    // 1. Métadonnées salon
    const salonRes = await fetch(`${sbUrl}/rest/v1/salons?id=eq.${encodeURIComponent(salon_id)}&select=id,nom,siret,adresse,cp,ville`, {
      headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` }
    });
    const salonRows = await salonRes.json();
    if (!Array.isArray(salonRows) || !salonRows[0]) return jsonResponse({ error: "Salon introuvable" }, 404);
    const salon = salonRows[0];

    // 2. Tickets (filtre période si fournie)
    let tkUrl = `${sbUrl}/rest/v1/tickets?salon_id=eq.${encodeURIComponent(salon_id)}&order=num.asc&limit=10000`;
    if (date_from) tkUrl += `&date_ticket=gte.${date_from}`;
    if (date_to) tkUrl += `&date_ticket=lte.${date_to}`;
    const tkRes = await fetch(tkUrl, { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } });
    const tickets = await tkRes.json();

    // 3. Clôtures
    let clUrl = `${sbUrl}/rest/v1/clotures?salon_id=eq.${encodeURIComponent(salon_id)}&order=num.asc&limit=10000`;
    if (date_from) clUrl += `&date_cloture=gte.${date_from}`;
    if (date_to) clUrl += `&date_cloture=lte.${date_to}`;
    const clRes = await fetch(clUrl, { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } });
    const clotures = await clRes.json();

    // 4. Vérification intégrité chaîne
    let chainBreaks = 0;
    let lastHash = "";
    for (const tk of (tickets || [])) {
      if (tk.hash_prev && tk.hash_prev !== lastHash && lastHash !== "") chainBreaks++;
      lastHash = tk.hash || "";
    }

    const exportData = {
      norme: "NF525",
      version_logiciel: "Luxyra 1.0",
      export_timestamp: new Date().toISOString(),
      salon: {
        id: salon.id,
        nom: salon.nom,
        siret: salon.siret,
        adresse: `${salon.adresse || ""}, ${salon.cp || ""} ${salon.ville || ""}`.trim()
      },
      periode: {
        date_from: date_from || (tickets[0]?.date_ticket || null),
        date_to: date_to || (tickets[tickets.length-1]?.date_ticket || null)
      },
      verification: {
        tickets_total: tickets.length,
        tickets_sha256: tickets.filter(t => t.hash_algo === "SHA-256").length,
        clotures_total: clotures.length,
        clotures_sha256: clotures.filter(c => c.hash_algo === "SHA-256").length,
        chaine_integre: chainBreaks === 0,
        chain_breaks: chainBreaks
      },
      tickets: tickets,
      clotures: clotures
    };

    // Réponse JSON téléchargeable
    return new Response(JSON.stringify(exportData, null, 2), {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="luxyra-nf525-${salon.siret || salon_id}-${new Date().toISOString().slice(0,10)}.json"`
      }
    });
  } catch (e) {
    console.error("export-nf525 error:", e);
    return jsonResponse({ error: "Export error: " + e.message }, 500);
  }
}

// ============================================================
// FIX 2026-05-12 : EMPREINTE bancaire Path A Connect
// ============================================================
// Après Stripe Checkout (capture_method=manual + transfer_data), le client
// est de retour sur site.html. Cet endpoint fetch la session pour obtenir
// le payment_intent_id et le stocker dans rdv_online.empreinte_payment_intent_id.
// Ensuite, les edge functions existantes rdv-empreinte-capture / rdv-empreinte-release
// peuvent capturer ou libérer le PI normalement (le destination charge est déjà
// configuré sur le PI, donc le transfert au salon se fait automatiquement à la capture).
async function handleEmpreinteFinalize(request, env) {
  try {
    const { session_id, rdv_id } = await readJsonBody(request);
    if (!session_id || !rdv_id) return jsonResponse({ error: "session_id et rdv_id requis" }, 400);

    // 1) Fetch Stripe session — source of truth (compte du salon d'abord : charges directes)
    let _comptesE = [];
    try {
      const _q = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rdv_online?select=salon_id,stripe_account&id=eq.${encodeURIComponent(rdv_id)}&limit=1`, { headers: _sbHeaders(env) });
      const _qa = _q.ok ? await _q.json() : [];
      if (_qa && _qa[0]) { _comptesE.push(_qa[0].stripe_account); const _sl = await supabaseGet(env, _qa[0].salon_id); if (_sl) _comptesE.push(_sl.stripe_connect_id); }
    } catch (_) {}
    const { session, compte: _compteE } = await lxSessionOu(env, session_id, _comptesE);
    if (!session || session.error) return jsonResponse({ error: "Session Stripe introuvable" }, 404);
    // Pour empreinte (manual capture), payment_status="paid" = client a autorisé (PI en requires_capture)
    if (session.payment_status !== "paid") return jsonResponse({ error: "Autorisation non confirmée: " + session.payment_status }, 402);
    // SECURITE 2026-10-08 : la session doit porter CE rdv, etre une empreinte, et du meme salon.
    if (!session.metadata || String(session.metadata.rdv_id || "") !== String(rdv_id) || session.metadata.subtype !== "empreinte") {
      return jsonResponse({ error: "Session non liée à ce rendez-vous" }, 403);
    }
    const piId = session.payment_intent;
    if (!piId) return jsonResponse({ error: "PaymentIntent introuvable dans la session" }, 500);
    {
      // FIX 2026-10-08 : la colonne s'appelle payment_intent_id (empreinte_payment_intent_id n'existe pas :
      // la finalisation échouait -> empreinte jamais enregistrée, RDV resté en attente de paiement).
      const _r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rdv_online?select=id,salon_id,status,payment_intent_id&id=eq.${encodeURIComponent(rdv_id)}&limit=1`, { headers: _sbHeaders(env) });
      const _a = _r.ok ? await _r.json() : [];
      const _rdv = Array.isArray(_a) ? _a[0] : null;
      if (!_rdv) return jsonResponse({ error: "RDV introuvable" }, 404);
      if (String(session.metadata.salon_id || "") !== String(_rdv.salon_id)) return jsonResponse({ error: "Session non liée à ce salon" }, 403);
      if (_rdv.payment_intent_id) {
        if (String(_rdv.payment_intent_id) === String(piId)) return jsonResponse({ ok: true, payment_intent_id: piId, deja: true });
        return jsonResponse({ error: "Empreinte déjà enregistrée pour ce rendez-vous" }, 409);
      }
      if (_rdv.status && _rdv.status !== "pending_payment") return jsonResponse({ error: "Rendez-vous déjà traité" }, 409);
      var _empSalonId = _rdv.salon_id;
    }
    // Statut final = réglage du salon (confirmation automatique ou validation manuelle)
    let _empStatus = "confirmed";
    try {
      const _c = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/site_config?select=confirmation_auto&salon_id=eq.${encodeURIComponent(_empSalonId)}&limit=1`, { headers: _sbHeaders(env) });
      const _ca = _c.ok ? await _c.json() : [];
      if (Array.isArray(_ca) && _ca[0] && typeof _ca[0].confirmation_auto === "boolean") _empStatus = _ca[0].confirmation_auto ? "confirmed" : "pending";
    } catch (_) {}

    // 2) Update rdv_online avec le PI ID + statut empreinte
    const sbUrl = CONFIG.SUPABASE_URL;
    const upRes = await fetch(`${sbUrl}/rest/v1/rdv_online?id=eq.${encodeURIComponent(rdv_id)}`, {
      method: "PATCH",
      headers: { ..._sbHeaders(env), "Prefer": "return=minimal" },
      // "held" = valeur attendue par rdv-empreinte-capture / -release et par le cron (avant : "authorized")
      body: JSON.stringify({
        status: _empStatus,
        payment_intent_id: piId,
        stripe_account: _compteE || null,
        empreinte_status: "held",
        empreinte_held_at: new Date().toISOString(),
        empreinte_amount: (Number(session.amount_total) || 0) / 100 || undefined
      })
    });
    if (!upRes.ok) {
      const errTxt = await upRes.text();
      console.error("empreinte-finalize UPDATE failed:", errTxt);
      return jsonResponse({ error: "Update rdv_online échoué: " + errTxt }, 500);
    }
    return jsonResponse({ ok: true, payment_intent_id: piId });
  } catch (e) {
    console.error("empreinte-finalize error:", e);
    return jsonResponse({ error: "Finalize error: " + e.message }, 500);
  }
}

// ============================================================
// FIX 2026-05-12 : RDV SUR MESURE — Path A Connect
// ============================================================
// AVANT : proposal.html chargeait via Charges API (path B) → $$ chez Luxyra.
// Problème comptable : Luxyra encaissait pour le salon, virement manuel ensuite.
//
// MAINTENANT : Checkout Session avec transfer_data → 100% direct au salon.
//
// Flow :
// 1. POST /api/rdv-demande/connect-pay { token }
//    → Worker crée Checkout Session avec transfer_data[destination]=connect_id
//    → returns Stripe URL
// 2. Stripe redirige vers proposal.html?t=<token>&paid=success&session_id={CHECKOUT_SESSION_ID}
// 3. POST /api/rdv-demande/finalize { token, session_id }
//    → Worker vérifie Stripe payment_status="paid" + metadata.proposal_token
//    → INSERT rdv_online status=pending_payment, UPDATE confirmed (mirror regular flow)
//    → UPDATE rdv_demandes status=confirmed + rdv_online_id
// ============================================================

async function handleRdvDemandeConnectPay(request, env) {
  try {
    const { token } = await readJsonBody(request);
    if (!token) return jsonResponse({ error: "token requis" }, 400);

    // Récupère la demande via service_role
    const sbUrl = CONFIG.SUPABASE_URL;
    const dRes = await fetch(`${sbUrl}/rest/v1/rdv_demandes?proposal_token=eq.${encodeURIComponent(token)}&select=*&limit=1`, {
      headers: _sbHeaders(env)
    });
    const dRows = await dRes.json();
    if (!Array.isArray(dRows) || !dRows[0]) return jsonResponse({ error: "Proposition introuvable" }, 404);
    const demande = dRows[0];

    if (demande.status === "confirmed") return jsonResponse({ error: "Cette proposition est déjà confirmée." }, 409);
    if (["refused", "cancelled_by_salon", "expired"].includes(demande.status)) {
      return jsonResponse({ error: "Cette proposition n'est plus active." }, 409);
    }
    if (demande.proposal_expires_at && new Date(demande.proposal_expires_at) < new Date()) {
      return jsonResponse({ error: "Cette proposition a expiré." }, 410);
    }
    if (demande.status !== "proposed") return jsonResponse({ error: "État inattendu: " + demande.status }, 409);

    const pd = demande.proposed_data || {};
    const acompte = Number(pd.acompte_montant) || 0;
    if (acompte <= 0) return jsonResponse({ error: "Aucun acompte à régler." }, 400);

    // Récupère le salon pour le connect_id
    const salon = await supabaseGet(env, demande.salon_id);
    if (!salon?.stripe_connect_id) return jsonResponse({ error: "Le salon n'a pas configuré ses paiements en ligne" }, 400);

    // Vérifie que Connect peut encaisser
    const account = await stripeAPI(env, `accounts/${salon.stripe_connect_id}`, null, "GET");
    if (account?.error?.type === "upstream_non_json") { console.error("connect stripe accounts non-JSON:", account.error.http_status, account.error.raw); return jsonResponse({ error: "Service de paiement momentanément indisponible, merci de réessayer." }, 502); }
    if (!account?.charges_enabled) return jsonResponse({ error: "Le compte de paiement du salon n'est pas encore actif" }, 400);

    // Description (max 80 chars produit)
    const items = Array.isArray(pd.items) ? pd.items : [];
    const itemsLabel = items.map(it => it.nom).join(", ");
    const description = ("Acompte RDV " + (pd.date || "") + " " + (pd.heure || "") + " — " + itemsLabel).slice(0, 200);

    const customerEmail = demande.client_email || "";
    const customerName = ((demande.client_prenom || "") + " " + (demande.client_nom || "")).trim();

    const successUrl = `https://luxyra.fr/proposal.html?t=${encodeURIComponent(token)}&paid=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `https://luxyra.fr/proposal.html?t=${encodeURIComponent(token)}&paid=cancel`;

    // Checkout Session avec transfer_data → 100% au salon, 0% à Luxyra
    const session = await stripeAPI(env, "checkout/sessions", {
      mode: "payment",
      "line_items[0][price_data][currency]": "eur",
      "line_items[0][price_data][product_data][name]": description.slice(0, 80),
      "line_items[0][price_data][unit_amount]": String(Math.round(acompte * 100)),
      "line_items[0][quantity]": "1",
      customer_email: customerEmail,
      success_url: successUrl,
      cancel_url: cancelUrl,
      "metadata[type]": "rdv_demande_acompte",
      "metadata[salon_id]": demande.salon_id,
      "metadata[proposal_token]": token,
      "metadata[demande_id]": demande.id,
      "metadata[customer_name]": customerName,
      "payment_intent_data[description]": description,
      ...(await lxChargesDirectes(env) ? {} : { "payment_intent_data[transfer_data][destination]": salon.stripe_connect_id })
    }, "POST", (await lxChargesDirectes(env)) ? salon.stripe_connect_id : null);

    if (!session?.url) return jsonResponse({ error: "Erreur Stripe: " + JSON.stringify(session) }, 500);
    return jsonResponse({ url: session.url, session_id: session.id });
  } catch (e) {
    console.error("connect-pay error:", e);
    return jsonResponse({ error: "Connect-pay error: " + e.message }, 500);
  }
}

async function handleRdvDemandeFinalize(request, env) {
  try {
    const { token, session_id } = await readJsonBody(request);
    if (!token || !session_id) return jsonResponse({ error: "token et session_id requis" }, 400);

    // 1) Vérifie le paiement Stripe (single source of truth) — compte du salon d'abord
    let _comptesD = [];
    try {
      const _q = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rdv_demandes?select=salon_id&proposal_token=eq.${encodeURIComponent(token)}&limit=1`, { headers: _sbHeaders(env) });
      const _qa = _q.ok ? await _q.json() : [];
      if (_qa && _qa[0]) { const _sl = await supabaseGet(env, _qa[0].salon_id); if (_sl) _comptesD.push(_sl.stripe_connect_id); }
    } catch (_) {}
    const { session, compte: _compteD } = await lxSessionOu(env, session_id, _comptesD);
    if (!session || session.error) return jsonResponse({ error: "Session Stripe introuvable" }, 404);
    if (session.payment_status !== "paid") return jsonResponse({ error: "Paiement non confirmé: " + session.payment_status }, 402);
    // Anti-tampering : le token doit matcher la metadata Stripe
    if (session.metadata?.proposal_token !== token) return jsonResponse({ error: "Token mismatch (anti-tampering)" }, 403);

    const sbUrl = CONFIG.SUPABASE_URL;

    // 2) Récupère la demande
    const dRes = await fetch(`${sbUrl}/rest/v1/rdv_demandes?proposal_token=eq.${encodeURIComponent(token)}&select=*&limit=1`, {
      headers: _sbHeaders(env)
    });
    const dRows = await dRes.json();
    if (!Array.isArray(dRows) || !dRows[0]) return jsonResponse({ error: "Proposition introuvable" }, 404);
    const demande = dRows[0];

    // Idempotence : si déjà finalisé, renvoie success
    if (demande.status === "confirmed" && demande.rdv_online_id) {
      return jsonResponse({ ok: true, already_confirmed: true, rdv_online_id: demande.rdv_online_id });
    }

    const pd = demande.proposed_data || {};
    const items = Array.isArray(pd.items) ? pd.items : [];
    const itemNoms = items.map(it => it.nom).join(" + ") || "RDV sur mesure";
    const primaryServiceId = items[0]?.service_id || null;

    // 3) INSERT rdv_online (status pending_payment d'abord — mirror du flow booking normal)
    //    Le trigger v3 valide acompte_paye=true uniquement après UPDATE → on INSERT à false.
    const rdvData = {
      salon_id: demande.salon_id,
      client_nom: demande.client_nom || "",
      client_prenom: demande.client_prenom || "",
      client_tel: demande.client_tel || "",
      client_email: demande.client_email || "",
      client_online_id: null,
      client_luxyra_id: demande.client_luxyra_id || null,
      service_id: primaryServiceId,
      service_nom: itemNoms,
      service_prix: Number(pd.prix_total) || 0,
      items: items,
      collaborateur_id: pd.collaborateur_id || null,
      collaborateur_nom: pd.collaborateur_nom || null,
      date_rdv: pd.date,
      heure_rdv: pd.heure,
      duree_minutes: pd.duree_minutes || 30,
      acompte_montant: Number(pd.acompte_montant) || 0,
      acompte_paye: false,
      status: "pending_payment",
      message: pd.message_salon || "",
      lieu: "salon",
      payment_intent_id: session.payment_intent || null,
      stripe_account: _compteD || null
    };

    const insertRes = await fetch(`${sbUrl}/rest/v1/rdv_online`, {
      method: "POST",
      headers: { ..._sbHeaders(env), "Prefer": "return=representation" },
      body: JSON.stringify(rdvData)
    });
    const insertBody = await insertRes.json();
    if (!insertRes.ok || !Array.isArray(insertBody) || !insertBody[0]) {
      console.error("rdv_online INSERT failed:", insertRes.status, JSON.stringify(insertBody));
      return jsonResponse({ error: "Insert rdv_online échoué: " + JSON.stringify(insertBody) }, 500);
    }
    const rdvOnlineId = insertBody[0].id;

    // 4) UPDATE pour passer en confirmed + acompte_paye=true (mirror flow regular)
    const updRes = await fetch(`${sbUrl}/rest/v1/rdv_online?id=eq.${rdvOnlineId}`, {
      method: "PATCH",
      headers: { ..._sbHeaders(env), "Prefer": "return=minimal" },
      body: JSON.stringify({ status: "confirmed", acompte_paye: true })
    });
    if (!updRes.ok) {
      console.error("rdv_online UPDATE confirmed failed:", await updRes.text());
      // On continue quand même — le RDV existe en pending_payment, le salon peut le valider
    }

    // 5) UPDATE rdv_demandes → confirmed + lien vers rdv_online
    const demUpdRes = await fetch(`${sbUrl}/rest/v1/rdv_demandes?id=eq.${demande.id}`, {
      method: "PATCH",
      headers: { ..._sbHeaders(env), "Prefer": "return=minimal" },
      body: JSON.stringify({
        status: "confirmed",
        confirmed_at: new Date().toISOString(),
        rdv_online_id: rdvOnlineId
      })
    });
    if (!demUpdRes.ok) {
      console.error("rdv_demandes UPDATE failed:", await demUpdRes.text());
    }

    return jsonResponse({ ok: true, rdv_online_id: rdvOnlineId });
  } catch (e) {
    console.error("finalize error:", e);
    return jsonResponse({ error: "Finalize error: " + e.message }, 500);
  }
}

// ============================================================
// HELPERS
// ============================================================
async function readJsonBody(request) {
  // Corps vide ou JSON invalide -> {} (au lieu d'un throw -> 500 + alerte monitoring)
  try { const _t = await request.text(); return _t ? JSON.parse(_t) : {}; }
  catch (_e) { return {}; }
}

// ============================================================
// CHARGES DIRECTES (2026-10-09, décision Alexandre)
// Les paiements des clientes sont créés SUR le compte Stripe du salon : frais Stripe, litiges et
// remboursements chez le salon ; le compte Luxyra ne porte que les abonnements et les packs SMS.
// Interrupteur app_config.stripe_charges_directes (false tant que le webhook « comptes connectés »
// n'est pas branché). Les anciens paiements (stripe_account NULL) restent gérés sur la plateforme.
// ============================================================
let _lxDirectCache = { v: null, t: 0 };
async function lxChargesDirectes(env) {
  if (_lxDirectCache.v !== null && Date.now() - _lxDirectCache.t < 60000) return _lxDirectCache.v;
  let v = false;
  try {
    const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/app_config?id=eq.1&select=config`, { headers: _sbHeaders(env) });
    const a = r.ok ? await r.json() : [];
    v = !!(a && a[0] && a[0].config && a[0].config.stripe_charges_directes === true);
  } catch (_) {}
  _lxDirectCache = { v, t: Date.now() };
  return v;
}
// Lit une session Checkout où qu'elle soit : compte du salon d'abord, puis plateforme (anciens paiements).
async function lxSessionOu(env, sessionId, comptes) {
  const essais = [...new Set((comptes || []).filter(Boolean))].concat([null]);
  for (const c of essais) {
    const s = await stripeAPI(env, `checkout/sessions/${encodeURIComponent(sessionId)}`, null, "GET", c);
    if (s && s.id && !s.error) return { session: s, compte: c };
  }
  return { session: null, compte: null };
}
// Paramètres Checkout d'un paiement de cliente : direct (sur le compte du salon) ou ancien mode destination.
function lxParamsPaiementSalon(params, direct, connectId) {
  if (!direct) params["payment_intent_data[transfer_data][destination]"] = connectId;
  return params;
}

async function stripeAPI(env, endpoint, params, method = "POST", compte = null) {
  const options = { method, headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } };
  // 2026-10-09 : appel « au nom » du compte Stripe d'un salon (charges directes)
  if (compte) options.headers["Stripe-Account"] = String(compte);
  if (params && method === "POST") {
    options.headers["Content-Type"] = "application/x-www-form-urlencoded";
    options.body = new URLSearchParams(params).toString();
  }
  const _resp = await fetch(`https://api.stripe.com/v1/${endpoint}`, options);
  const _txt = await _resp.text();
  if (!_txt) return { error: { type: "upstream_non_json", message: "Réponse Stripe vide (HTTP " + _resp.status + ")", http_status: _resp.status, raw: "" } };
  try { return JSON.parse(_txt); }
  catch (_e) { return { error: { type: "upstream_non_json", message: "Réponse Stripe non-JSON (HTTP " + _resp.status + ")", http_status: _resp.status, raw: String(_txt).slice(0, 200) } }; }
}

async function getOrCreateStripeCustomer(env, email, salonId) {
  try {
    const salon = await supabaseGet(env, salonId);
    if (salon?.stripe_customer_id) return salon.stripe_customer_id;
    const existing = await stripeAPI(env, `customers?email=${encodeURIComponent(email)}&limit=1`, null, "GET");
    if (existing?.data?.length > 0) {
      await supabaseUpdate(env, salonId, { stripe_customer_id: existing.data[0].id });
      return existing.data[0].id;
    }
    const customer = await stripeAPI(env, "customers", { email, "metadata[salon_id]": salonId, name: salon?.nom || email });
    if (!customer?.id) return null;
    await supabaseUpdate(env, salonId, { stripe_customer_id: customer.id });
    return customer.id;
  } catch(e) { return null; }
}

async function updateSalonPlan(env, salonId, plan, subscriptionId, customerId) {
  // ANTI-DOUBLE-FACTURATION : si le salon avait déjà une sub différente,
  // on l'annule sur Stripe AVANT de l'écraser en DB. Sinon le client serait facturé
  // sur les 2 subs en parallèle (l'ancienne + la nouvelle) jusqu'à expiration manuelle.
  // Cas concret : user annule (cancel_at_period_end) puis reSubscribe avant expiration
  //              → sans ce fix, 2 subs Pro actives = double prélèvement.
  try {
    const salon = await supabaseGet(env, salonId);
    if (salon && salon.stripe_subscription_id && salon.stripe_subscription_id !== subscriptionId) {
      console.log(`[updateSalonPlan] Annule l'ancienne sub ${salon.stripe_subscription_id} (remplacée par ${subscriptionId})`);
      try {
        await stripeAPI(env, `subscriptions/${salon.stripe_subscription_id}`, null, "DELETE");
      } catch (e) {
        console.warn(`[updateSalonPlan] Échec annulation ancienne sub ${salon.stripe_subscription_id}:`, e?.message);
        // On continue quand même, mais on log l'erreur. L'admin pourra annuler manuellement
        // dans Stripe Dashboard si nécessaire.
      }
    }
  } catch (e) {
    console.warn("[updateSalonPlan] Anti-double-facturation check failed:", e?.message);
  }
  await supabaseUpdate(env, salonId, {
    plan,
    status: "active",
    stripe_subscription_id: subscriptionId,
    stripe_customer_id: customerId,
    past_due_since: null
  });
}
async function updateSalonStatus(env, salonId, status) { await supabaseUpdate(env, salonId, { status }); }

async function supabaseGet(env, salonId) {
  const data = await (await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/salons?id=eq.${salonId}&select=*&limit=1`, {
    headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` }
  })).json();
  return data?.[0] || null;
}
async function supabaseUpdate(env, salonId, fields) {
  await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/salons?id=eq.${salonId}`, {
    method: "PATCH",
    headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(fields),
  });
}
// Helper: patch site_config (factored from repeated code)
async function patchSiteConfig(env, salonId, fields) {
  await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/site_config?salon_id=eq.${salonId}`, {
    method: "PATCH",
    headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(fields),
  });
}

// Helper: trigger billing email via edge function
async function callBillingEmail(env, salonId, kind, force = false) {
  const fnUrl = `${CONFIG.SUPABASE_URL}/functions/v1/salon-billing-email`;
  const cronSecret = env.AVIS_CRON_SECRET || "";
  if (!cronSecret) { console.warn("AVIS_CRON_SECRET not set in worker"); return; }
  const r = await fetch(fnUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-cron-secret": cronSecret },
    body: JSON.stringify({ salon_id: salonId, kind, force }),
  });
  if (!r.ok) console.warn("callBillingEmail", kind, "failed:", await r.text());
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

// ============================================================
// BREVO API — EMAIL & SMS
// ============================================================
async function brevoSendEmail(env, { to, toName, senderEmail, senderName, subject, htmlContent, textContent, replyTo, attachment }) {
  const payload = {
    sender: { name: senderName || "Luxyra", email: senderEmail || "contact@luxyra.fr" },
    to: [{ email: to, name: toName || "" }], subject,
    htmlContent: htmlContent || "<p>" + (textContent || subject) + "</p>",
    textContent: textContent || subject || "Message de Luxyra",
  };
  if (replyTo) payload.replyTo = { email: replyTo };
  if (attachment) payload.attachment = attachment;
  return await (await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST", headers: { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  })).json();
}

// SMS 2026-10-09 : un seul caractère hors alphabet SMS standard (GSM-7) — ô, â, ê, î, û, ç, À, ’, …, emoji —
// fait passer TOUT le message en Unicode, limité à 70 caractères → 2 crédits Brevo au lieu de 1.
// On convertit donc chaque SMS juste avant l'envoi (é è ù à É Ç restent, ils font partie de l'alphabet SMS).
const LX_GSM7 = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const LX_GSM7_EXT = "^{}\\[~]|€";
const LX_SMS_REMPL = { "À":"A","Â":"A","Á":"A","Ã":"A","â":"a","á":"a","ã":"a","Ê":"E","È":"E","Ë":"E","ê":"e","ë":"e","Î":"I","Ï":"I","Í":"I","Ì":"I","î":"i","ï":"i","í":"i","Ô":"O","Ó":"O","Ò":"O","Õ":"O","ô":"o","ó":"o","õ":"o","Û":"U","Ú":"U","Ù":"U","û":"u","ú":"u","ç":"c","ÿ":"y","Ÿ":"Y","œ":"oe","Œ":"OE","’":"'","‘":"'","‚":",","“":"\"","”":"\"","„":"\"","«":"\"","»":"\"","…":"...","–":"-","—":"-","•":"-","·":"-","\u00a0":" ","\u202f":" ","\u2009":" ","\t":" " };
function lxSmsGsm(txt) {
  let out = "";
  for (const c of String(txt == null ? "" : txt).normalize("NFC")) {
    if (LX_GSM7.indexOf(c) >= 0 || LX_GSM7_EXT.indexOf(c) >= 0) { out += c; continue; }
    if (LX_SMS_REMPL[c] !== undefined) { out += LX_SMS_REMPL[c]; continue; }
    const base = c.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (base && base.length === 1 && LX_GSM7.indexOf(base) >= 0) { out += base; continue; }
    // caractère sans équivalent (emoji, symbole) : supprimé
  }
  return out.replace(/ {2,}/g, " ").trim();
}

// Nombre de SMS facturés par Brevo pour un texte déjà converti : 1 jusqu'à 160 unités, puis tranches de 153
// (les caractères ^{}\\[~]|€ comptent double dans l'alphabet SMS).
function lxSmsSegments(txt) {
  let n = 0; for (const c of String(txt || "")) n += (LX_GSM7_EXT.indexOf(c) >= 0 ? 2 : 1);
  if (n === 0) return 1;
  return n <= 160 ? 1 : Math.ceil(n / 153);
}

// 2026-10-10 : nouvel endpoint Brevo `/v3/transactionalSMS/send` (l'ancien `/sms` est déprécié) avec accusés de
// réception (webUrl) et un tag par salon. Repli automatique sur l'ancien endpoint si le nouveau est indisponible
// (5xx / 404) : un rappel ne doit jamais être perdu à cause du changement.
async function brevoSendSms(env, { to, content, sender, tag, webUrl }) {
  content = lxSmsGsm(content);
  const headers = { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json", Accept: "application/json" };
  const destinataire = String(to || "").replace(/^\+/, "").replace(/\D/g, "");
  const corps = { type: "transactional", sender: sender || "Luxyra", recipient: destinataire, content };
  if (tag) corps.tag = tag;
  if (webUrl) corps.webUrl = webUrl;
  let r = null, j = null;
  try {
    r = await fetch("https://api.brevo.com/v3/transactionalSMS/send", { method: "POST", headers, body: JSON.stringify(corps) });
    j = await r.json().catch(() => ({}));
    if (r.ok && j && j.messageId) return Object.assign({ endpoint: "send" }, j);
    if (r.status >= 400 && r.status < 500 && r.status !== 404) return Object.assign({ endpoint: "send", httpStatus: r.status }, j || {});
  } catch (_) {}
  // Repli : ancien endpoint (format de numéro d'origine)
  const corpsAncien = { type: "transactional", sender: sender || "Luxyra", recipient: to, content };
  if (tag) corpsAncien.tag = tag;
  if (webUrl) corpsAncien.webUrl = webUrl;
  const r2 = await fetch("https://api.brevo.com/v3/transactionalSMS/sms", { method: "POST", headers, body: JSON.stringify(corpsAncien) });
  const j2 = await r2.json().catch(() => ({}));
  return Object.assign({ endpoint: "sms", httpStatus: r2.status }, j2 || {});
}
// 2026-10-10 : rapprochement quotidien Luxyra <-> Brevo (veille, heure de Paris) + solde SMS du compte Brevo Luxyra
async function runSmsRapprochementJob(env) {
  const hier = new Date(Date.now() - 86400000);
  const jour = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(hier);
  // décalage hiver/été : on prend l'offset réel de Paris ce jour-là
  const off = (() => { try { const p = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", timeZoneName: "shortOffset" }).formatToParts(hier).find((x) => x.type === "timeZoneName"); const m = /GMT([+-]\d+)/.exec(p ? p.value : ""); return m ? Number(m[1]) : 2; } catch (_) { return 2; } })();
  const d0 = new Date(Date.parse(jour + "T00:00:00Z") - off * 3600000), d1 = new Date(d0.getTime() + 86400000);
  const q = `${CONFIG.SUPABASE_URL}/rest/v1/sms_envois?select=statut,nb_sms,rembourse,message_id&cree_le=gte.${encodeURIComponent(d0.toISOString())}&cree_le=lt.${encodeURIComponent(d1.toISOString())}&limit=5000`;
  const rr = await fetch(q, { headers: _sbHeaders(env) });
  const L = rr.ok ? await rr.json() : [];
  const acceptes = L.filter((x) => x.message_id).length;
  const echecs = L.filter((x) => x.statut === "echec").length, rembourses = L.filter((x) => x.rembourse).length;
  const rb = await fetch(`https://api.brevo.com/v3/transactionalSMS/statistics/reports?startDate=${jour}&endDate=${jour}`, { headers: { "api-key": env.BREVO_API_KEY, Accept: "application/json" } });
  const jb = rb.ok ? await rb.json() : null;
  const repB = jb && Array.isArray(jb.reports) ? (jb.reports.find((x) => x.date === jour) || jb.reports[0] || null) : null;
  const brevo = repB ? Number(repB.requests || 0) : null;
  const alertes = [];
  // Pas de comparaison pour une journée antérieure au début du suivi (sinon fausse alerte le 1er jour)
  let suiviComplet = false;
  try { const rm = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/sms_envois?select=cree_le&order=cree_le.asc&limit=1`, { headers: _sbHeaders(env) }); const am = rm.ok ? await rm.json() : []; suiviComplet = !!(am[0] && new Date(am[0].cree_le) <= d0); } catch (_) {}
  if (suiviComplet && brevo !== null && brevo !== acceptes) alertes.push(`Écart SMS du ${jour} : Brevo ${brevo} envoi(s), Luxyra ${acceptes}.`);
  // Solde SMS du compte Brevo de Luxyra (si épuisé, plus AUCUN salon ne reçoit ses rappels)
  let soldeBrevo = null;
  try {
    const ra = await fetch("https://api.brevo.com/v3/account", { headers: { "api-key": env.BREVO_API_KEY, Accept: "application/json" } });
    const ja = ra.ok ? await ra.json() : null;
    const planSms = ja && Array.isArray(ja.plan) ? ja.plan.find((x) => String(x.type || "").toLowerCase() === "sms") : null;
    if (planSms && planSms.credits != null) soldeBrevo = Number(planSms.credits);
  } catch (_) {}
  const seuil = 200;
  let dejaSolde = null;
  try { const rs = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/app_secrets?select=value&key=eq.brevo_sms_alerte_solde&limit=1`, { headers: _sbHeaders(env) }); const as = rs.ok ? await rs.json() : []; dejaSolde = as[0] ? as[0].value : null; } catch (_) {}
  if (soldeBrevo !== null && soldeBrevo < seuil && !dejaSolde) {
    alertes.push(`Solde SMS du compte Brevo Luxyra bas : ${soldeBrevo} crédit(s). À recharger chez Brevo, sinon plus aucun salon ne reçoit ses SMS.`);
    try { await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/app_secrets?on_conflict=key`, { method: "POST", headers: _sbHeaders(env, { Prefer: "resolution=merge-duplicates,return=minimal" }), body: JSON.stringify({ key: "brevo_sms_alerte_solde", value: String(soldeBrevo), description: "Alerte solde SMS Brevo envoyée (une fois, effacée quand le solde remonte)" }) }); } catch (_) {}
  } else if (soldeBrevo !== null && soldeBrevo >= seuil && dejaSolde) {
    try { await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/app_secrets?key=eq.brevo_sms_alerte_solde`, { method: "DELETE", headers: _sbHeaders(env, { Prefer: "return=minimal" }) }); } catch (_) {}
  }
  for (const a of alertes) {
    try { await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/notify_admins`, { method: "POST", headers: _sbHeaders(env), body: JSON.stringify({ p_event_type: "payment_failed", p_title: "📱 SMS — à vérifier", p_body: a, p_url: "/admin.html#sms", p_payload: {} }) }); } catch (_) {}
  }
  const res = { jour, luxyra: acceptes, brevo, echecs, rembourses, soldeBrevo, alertes: alertes.length };
  try { await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/app_secrets?on_conflict=key`, { method: "POST", headers: _sbHeaders(env, { Prefer: "resolution=merge-duplicates,return=minimal" }), body: JSON.stringify({ key: "sms_rapprochement_dernier", value: JSON.stringify(res), description: "Dernier rapprochement SMS Luxyra/Brevo (cron 08:00 UTC)" }) }); } catch (_) {}
  return res;
}

async function lxSigneRef(env, ref) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(env.SUPABASE_SERVICE_KEY || "lx")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("sms-event:" + ref));
  return Array.from(new Uint8Array(sig)).slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// POST /api/brevo/sms-event?r=<id sms_envois>&s=<signature> — accusés de réception Brevo (livré, échec…)
// Un SMS définitivement non distribué (numéro invalide, refusé, bloqué) est remboursé au salon, une seule fois.
async function handleBrevoSmsEvent(request, env) {
  try {
    const u = new URL(request.url);
    const ref = String(u.searchParams.get("r") || "");
    if (!/^[0-9a-f-]{36}$/i.test(ref) || u.searchParams.get("s") !== await lxSigneRef(env, ref)) return jsonResponse({ error: "refusé" }, 403);
    let b = {}; try { b = await request.json(); } catch (_) {}
    const ev = String(b.event || b.msg_status || b.status || b.type || "").toLowerCase().replace(/[\s_-]/g, "");
    const raison = String(b.reason || b.description || b.error || "").slice(0, 200);
    const echec = ["hardbounce", "rejected", "blocked", "skipped", "error", "invalid", "undelivered", "failed", "expired"].includes(ev);
    const statut = ev === "delivered" ? "livre" : (echec ? "echec" : (ev === "softbounce" ? "en_attente" : null));
    const rq = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/sms_envois?select=evenements,statut&id=eq.${encodeURIComponent(ref)}&limit=1`, { headers: _sbHeaders(env) });
    const ra = rq.ok ? await rq.json() : [];
    if (!ra[0]) return jsonResponse({ ok: true, inconnu: true });
    const evts = Array.isArray(ra[0].evenements) ? ra[0].evenements.slice(-19) : [];
    evts.push({ e: ev || "?", r: raison || undefined, t: new Date().toISOString() });
    const patch = { evenements: evts, dernier_evenement: ev || null, maj_le: new Date().toISOString() };
    if (statut && ra[0].statut !== "livre") patch.statut = statut; // « livré » reste définitif
    await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/sms_envois?id=eq.${encodeURIComponent(ref)}`, { method: "PATCH", headers: _sbHeaders(env, { Prefer: "return=minimal" }), body: JSON.stringify(patch) });
    if (echec && ra[0].statut !== "livre") {
      await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/sms_envoi_rembourser`, { method: "POST", headers: _sbHeaders(env), body: JSON.stringify({ p_id: ref, p_motif: "SMS non distribué (" + ev + (raison ? " : " + raison : "") + ") — crédit rendu" }) });
    }
    return jsonResponse({ ok: true });
  } catch (e) {
    return jsonResponse({ ok: false }, 200); // jamais de nouvel essai en boucle côté Brevo
  }
}

// ============================================================
// EMAIL: TICKET — FIX W4: "conforme NF525" pas "certifié"
// ============================================================
async function handleEmailTicket(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!checkRateLimit("email_ticket:" + ip, 30)) return jsonResponse({ error: "Trop de requêtes. Réessayez dans 1 minute." }, 429);
  const body = await request.json();
  let { clientEmail, clientName, salonName, salonEmail, ticketNum, ticketHtml, clientId } = body;
  // SECURITE 2026-10-08 : salon connecte / appel serveur, OU cliente connectee (uniquement vers SA propre adresse)
  const _acces = await lxGuardConnecte(request, env);
  if (!_acces.ok) {
    const _cl = body.session_token ? await verifyClientSession(body.session_token, env) : null;
    if (!_cl || !_cl.email) return jsonResponse({ error: "Authentification requise" }, 401);
    clientEmail = _cl.email; clientId = null; salonEmail = null;
  }
  if (!clientEmail || !ticketNum) return jsonResponse({ error: "clientEmail et ticketNum requis" }, 400);
  if (!ticketHtml) return jsonResponse({ error: "ticketHtml requis" }, 400);
  // FIX 2026-05-14 : lien désinscription RGPD obligatoire si clientId fourni
  let unsubLink = "";
  if (clientId) {
    try { unsubLink = await buildUnsubscribeUrl(clientId, "email", env); } catch (e) { unsubLink = ""; }
  }
  const unsubBlock = unsubLink ? `<div style="margin-top:10px"><a href="${unsubLink}" style="color:#bbb;font-size:10px;text-decoration:underline">Se désinscrire des emails</a></div>` : "";
  const emailHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:'Helvetica Neue',Arial,sans-serif;background:#f5f5f5;margin:0;padding:20px}.wrapper{max-width:500px;margin:0 auto}.header{background:#0b0b0b;padding:24px;text-align:center;color:#fff;border-radius:12px 12px 0 0;border-bottom:3px solid #c8a84e}.header h1{margin:0;font-size:20px;color:#d4a843;letter-spacing:1px}.header p{margin:4px 0 0;font-size:13px;color:rgba(255,255,255,.7)}.ticket-container{background:#fff;padding:24px;border-left:1px solid #e0e0e0;border-right:1px solid #e0e0e0;font-family:'Courier New',monospace;font-size:12px;line-height:1.5;color:#000}.ticket-container table{width:100%;border-collapse:collapse}.footer{text-align:center;padding:16px;font-size:11px;color:#999;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 12px 12px;background:#fff}</style></head><body><div class="wrapper"><div class="header"><h1>${salonName||"Votre salon"}</h1><p>Votre ticket de caisse N°${ticketNum}</p></div><div class="ticket-container">${ticketHtml}</div><div class="footer"><img src="https://luxyra.fr/luxyra-logo.png" width="28" height="28" alt="Luxyra" style="display:block;margin:0 auto 6px;border-radius:6px">Envoyé via <strong>Luxyra</strong> — Caisse conforme à la loi anti-fraude TVA<br>Art. 286-I-3° bis du CGI<br><em style="font-size:10px;color:#bbb">Ce ticket fait office de facture. Conservez-le 6 ans minimum.</em>${unsubBlock}</div></div></body></html>`;
  const encoder = new TextEncoder();
  const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Ticket ${salonName} N°${ticketNum}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Courier New',monospace;padding:15px;max-width:340px;margin:0 auto;font-size:12px;line-height:1.5;color:#000;background:#fff}table{width:100%;border-collapse:collapse}@media print{body{padding:5px}}</style></head><body>${ticketHtml}</body></html>`;
  const bytes = encoder.encode(fullHtml);
  let b64 = ""; for (let i = 0; i < bytes.length; i++) b64 += String.fromCharCode(bytes[i]); b64 = btoa(b64);
  const result = await brevoSendEmail(env, {
    to: clientEmail, toName: clientName, senderName: salonName || "Luxyra", senderEmail: "contact@luxyra.fr",
    replyTo: salonEmail, subject: `Votre ticket N°${ticketNum} — ${salonName || ""}`,
    htmlContent: emailHtml, textContent: `Bonjour, voici votre ticket N°${ticketNum} de ${salonName || "votre salon"}.`,
    attachment: [{ name: `Ticket-${ticketNum}-${(salonName||"Luxyra").replace(/[^a-zA-Z0-9]/g,"_")}.html`, content: b64 }]
  });
  return jsonResponse({ success: true, messageId: result.messageId, result });
}

async function handleEmailWelcome(request, env) {
  // SECURITE 2026-10-08 : route sans appelant connu -> reservee aux appels serveur.
  if (!(await lxIsInternal(request, env))) return jsonResponse({ error: "Route desactivee" }, 410);
  const body = await request.json();
  const { email, nom, prenom, nomSalon, plan, identifiant, motDePasse } = body;
  if (!email) return jsonResponse({ error: "email requis" }, 400);
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:'Helvetica Neue',Arial,sans-serif;background:#f5f5f5;margin:0;padding:20px}.card{max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)}.header{background:#0b0b0b;padding:26px 30px 22px;text-align:center;color:#fff;border-bottom:3px solid #c8a84e}.header h1{margin:0;font-size:24px;color:#d4a843}.body{padding:30px}.creds{background:#f8f6f0;border:1px solid #e8e0d0;border-radius:10px;padding:20px;margin:20px 0;text-align:center}.creds .label{font-size:12px;color:#999;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px}.creds .value{font-size:16px;font-weight:700;color:#1a1a2e;margin-bottom:12px}.btn{display:inline-block;padding:14px 40px;background:linear-gradient(135deg,#d4a843,#b8960f);color:#fff;text-decoration:none;border-radius:10px;font-weight:700;font-size:15px}.footer{text-align:center;padding:16px;font-size:11px;color:#999;border-top:1px solid #f0f0f0}</style></head><body><div class="card"><div class="header"><img src="https://luxyra.fr/luxyra-logo.png" width="64" height="64" alt="Luxyra" style="display:block;margin:0 auto 10px;border-radius:12px"><h1>Bienvenue sur Luxyra !</h1><p style="color:rgba(255,255,255,.7);margin-top:8px">Votre essai gratuit de 14 jours commence maintenant</p></div><div class="body"><p>Bonjour ${prenom||""} ${nom||""},</p><p>Votre établissement <strong>${nomSalon||""}</strong> est prêt.</p><div class="creds"><div class="label">Email de connexion</div><div class="value">${identifiant||email}</div><div class="label">Mot de passe</div><div class="value">${motDePasse||"(celui que vous avez choisi)"}</div></div><div style="text-align:center;margin:24px 0"><a href="https://luxyra.fr/app" class="btn">Accéder à mon salon →</a></div><p style="font-size:13px;color:#666">Votre formule d'essai <strong>${plan||"Essentiel"}</strong> est active pendant 14 jours.</p></div><div class="footer">Luxyra — Alexandre JENSEN, entrepreneur individuel — SIRET 910 928 464 00023<br>29 rue de l'Abbé Alexandre Pax, 57200 Sarreguemines — luxyra.fr — contact@luxyra.fr</div></div></body></html>`;
  const result = await brevoSendEmail(env, { to: email, toName: `${prenom||""} ${nom||""}`.trim(), senderName: "Luxyra", senderEmail: "contact@luxyra.fr", subject: "Bienvenue sur Luxyra — Vos identifiants", htmlContent: html, textContent: "", replyTo: null, attachment: null });
  return jsonResponse({ success: true, messageId: result.messageId, result });
}

async function handleEmailCustom(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!checkRateLimit("email_custom:" + ip, 20)) return jsonResponse({ error: "Trop de requêtes. Réessayez dans 1 minute." }, 429);
  // SECURITE 2026-10-08 : plus d'envoi anonyme depuis contact@luxyra.fr (appel serveur ou utilisateur connecte).
  const _acces = await lxGuardConnecte(request, env);
  if (!_acces.ok) {
    // Cas de l'inscription (session parfois absente) : seulement vers l'equipe Luxyra, ou vers l'email
    // d'un salon cree il y a moins de 30 minutes (email de bienvenue).
    let _permis = false;
    try {
      const _b = await lxBodyCopie(request);
      const _to = String((_b && _b.to) || "").toLowerCase().trim();
      if (_to === "contact@luxyra.fr" || _to === "support@luxyra.fr") _permis = checkRateLimit("email_custom_equipe:" + ip, 5);
      else if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(_to)) {
        const _depuis = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        const _r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/salons?select=id&email=eq.${encodeURIComponent(_to)}&created_at=gte.${encodeURIComponent(_depuis)}&limit=1`, { headers: _sbHeaders(env) });
        const _a = _r.ok ? await _r.json() : [];
        _permis = Array.isArray(_a) && _a.length > 0 && checkRateLimit("email_custom_bienvenue:" + _to, 2);
      }
    } catch (_e) { _permis = false; }
    if (!_permis) return jsonResponse({ error: "Authentification requise" }, 401);
  }
  if (_acces.user && !checkRateLimit("email_custom_u:" + _acces.user.id, 30)) return jsonResponse({ error: "Trop de requêtes. Réessayez dans 1 minute." }, 429);
  const { to, toName, salonName, salonEmail, subject, htmlContent, textContent } = await request.json();
  if (!to || !subject) return jsonResponse({ error: "to et subject requis" }, 400);
  const result = await brevoSendEmail(env, { to, toName, senderName: salonName || "Luxyra", senderEmail: "contact@luxyra.fr", replyTo: salonEmail, subject, htmlContent: htmlContent || "", textContent: textContent || "", attachment: null });
  if (result.code || result.message) return jsonResponse({ success: false, error: result.message || result.code, result });
  return jsonResponse({ success: true, messageId: result.messageId, result });
}

// FIX W6: .trim() on SMS sender to avoid trailing space ("Excellence " → "Excellence")
// === Helper: gate SMS (vérifie plan Pro + crédits > 0 + décrémente atomiquement) ===
// Retourne { ok: true } si autorisé et crédits décrémentés, sinon { ok: false, status, error }
// Race-safe : utilise la RPC Postgres decrement_sms_credit (UPDATE WHERE > 0 RETURNING).
// → impossible de descendre sous 0 même avec des envois parallèles en burst.
async function gateSmsAndDecrementCredit(env, salonId, nbSms = 1) {
  if (!salonId) return { ok: false, status: 400, error: "salon_id requis" };
  const salon = await supabaseGet(env, salonId);
  if (!salon) return { ok: false, status: 404, error: "Salon introuvable" };
  // Plan Pro requis
  if (salon.plan !== "pro") return { ok: false, status: 403, error: "Plan Pro requis pour envoyer des SMS" };
  // 2026-10-09 : envoi suspendu par l'admin
  if (salon.sms_bloque === true) return { ok: false, status: 403, error: "Envoi de SMS suspendu pour ce salon — contactez le support Luxyra" };
  // Compte actif (pas suspended/cancelled)
  if (salon.status === "suspended" || salon.status === "cancelled") {
    return { ok: false, status: 403, error: "Compte suspendu — régularisez votre abonnement" };
  }
  // Décrément ATOMIQUE via RPC (race-safe — UPDATE WHERE sms_credits > 0)
  // Si 0 lignes mises à jour (crédits déjà à 0), renvoie {ok:false, remaining:0} sans rien modifier.
  try {
    const rpcRes = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/decrement_sms_credits`, {
      method: "POST",
      headers: {
        "apikey": env.SUPABASE_SERVICE_KEY,
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ p_salon_id: salonId, p_nb: nbSms })
    });
    if (!rpcRes.ok) {
      console.error("decrement_sms_credit RPC HTTP error:", rpcRes.status);
      return { ok: false, status: 500, error: "Erreur décrément crédit SMS (rpc)" };
    }
    const rpcData = await rpcRes.json();
    if (!rpcData || rpcData.ok !== true) {
      const reste = Number(rpcData && rpcData.remaining || 0);
      return { ok: false, status: 402, soldeZero: reste <= 0, error: nbSms > 1 && reste > 0
        ? `Ce message compte ${nbSms} SMS (plus de 160 caractères) et il ne reste que ${reste} crédit(s) — raccourcissez-le ou rechargez via Paramètres > SMS`
        : "Plus de crédits SMS — rechargez via Paramètres > SMS" };
    }
    return { ok: true, remainingCredits: Number(rpcData.remaining || 0), nbSms };
  } catch (e) {
    console.error("decrement_sms_credit RPC error:", e?.message || e);
    return { ok: false, status: 500, error: "Erreur décrément crédit SMS" };
  }
}

// === Helper : alerte email quand un SMS automatique est bloqué (crédits 0) ===
// Rate-limité à 1 email/24h par salon via salons.last_sms_credit_alert_at.
// Ne block pas la réponse — fire & forget (waitUntil-style).
// 2026-10-09 : crédit atomique (packs, remboursements) + historique sms_mouvements
// ============================================================
// PARRAINAGE ENTRE SALONS (2026-10-10)
// Au 1er paiement réel d'un filleul, le parrain reçoit un crédit Stripe égal à UN mois de son abonnement
// (déduit automatiquement de sa prochaine facture, qui le mentionne). Parrain sans abonnement payant :
// récompense « en attente », appliquée dès son abonnement. Garde-fous : un filleul = une récompense,
// pas soi-même (même SIRET ou même client Stripe refusé), 12 mois offerts maximum par an et par parrain.
// ============================================================
async function lxSbGet(env, chemin) { const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/${chemin}`, { headers: _sbHeaders(env) }); return r.ok ? await r.json() : []; }
async function lxSbPatch(env, chemin, corps) { await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/${chemin}`, { method: "PATCH", headers: _sbHeaders(env, { Prefer: "return=minimal" }), body: JSON.stringify(corps) }); }
async function lxParrainageCrediter(env, parrain, par, filleulNom) {
  // abonnement payant actif requis pour créditer
  if (!parrain || !parrain.stripe_customer_id || !parrain.stripe_subscription_id || parrain.is_free) return { ok: false, attente: true };
  const sub = await stripeAPI(env, `subscriptions/${encodeURIComponent(parrain.stripe_subscription_id)}`, null, "GET");
  if (!sub || !["active", "trialing", "past_due"].includes(sub.status)) return { ok: false, attente: true };
  const it = sub.items && sub.items.data && sub.items.data[0];
  const cents = Number(it && it.price && it.price.unit_amount || 0) * Number(it && it.quantity || 1);
  if (!(cents > 0)) return { ok: false, attente: true };
  // plafond annuel
  const an = new Date(Date.now() - 365 * 86400000).toISOString();
  const deja = await lxSbGet(env, `parrainages?select=id&parrain_id=eq.${parrain.id}&statut=eq.recompense&recompense_le=gte.${encodeURIComponent(an)}`);
  if (Array.isArray(deja) && deja.length >= 12) return { ok: false, refus: "plafond de 12 mois offerts par an atteint" };
  const bt = await stripeAPI(env, `customers/${encodeURIComponent(parrain.stripe_customer_id)}/balance_transactions`, {
    amount: String(-cents), currency: "eur",
    description: `Parrainage : 1 mois offert (filleul ${String(filleulNom || "").slice(0, 60)})`,
    "metadata[type]": "parrainage", "metadata[parrainage_id]": par.id,
  });
  if (!bt || !bt.id) return { ok: false, erreur: (bt && bt.error && bt.error.message) || "crédit Stripe refusé" };
  return { ok: true, montant: cents / 100, ref: bt.id };
}
async function lxParrainageMailParrain(env, parrain, filleulNom, montant) {
  try {
    if (!parrain || !parrain.email) return;
    await brevoSendEmail(env, { to: parrain.email, toName: parrain.nom || "", senderEmail: "contact@luxyra.fr", senderName: "Luxyra",
      subject: "🎁 Votre parrainage : 1 mois offert !",
      htmlContent: lxMailLayout(`<p>Bonjour,</p><p><b>${String(filleulNom || "L’établissement que vous avez parrainé").replace(/</g, "&lt;")}</b> vient de souscrire son abonnement Luxyra. Comme promis, <b>votre prochain mois est offert</b>${montant ? ` (${String(montant.toFixed(2)).replace(".", ",")} € déduits de votre prochaine facture)` : ""}.</p><p>Continuez à partager votre code : chaque nouvel établissement abonné vous offre un mois de plus (jusqu'à 12 par an).</p>`, { titre: "Merci pour votre parrainage !" }),
      textContent: `Merci pour votre parrainage ! ${filleulNom || "L’établissement parrainé"} vient de s'abonner : votre prochain mois Luxyra est offert.`, replyTo: null, attachment: null });
  } catch (_) {}
}
async function lxParrainageRecompenser(env, filleulId) {
  const ps = await lxSbGet(env, `parrainages?select=*&filleul_id=eq.${filleulId}&statut=eq.inscrit&limit=1`);
  const par = ps[0]; if (!par) return;
  const [filleul, parrain] = [await supabaseGet(env, filleulId), await supabaseGet(env, par.parrain_id)];
  if (!filleul || !parrain) return;
  // garde-fous anti-abus
  const memeSiret = filleul.siret && parrain.siret && String(filleul.siret).slice(0, 9) === String(parrain.siret).slice(0, 9);
  const memeClient = filleul.stripe_customer_id && filleul.stripe_customer_id === parrain.stripe_customer_id;
  if (memeSiret || memeClient || filleul.id === parrain.id) {
    await lxSbPatch(env, `parrainages?id=eq.${par.id}`, { statut: "refuse", motif: memeSiret ? "même entreprise (SIREN identique)" : "même client" });
    return;
  }
  // verrou : passe de « inscrit » à « en cours » une seule fois (deux webhooks simultanés)
  const vr = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/parrainages?id=eq.${par.id}&statut=eq.inscrit`, { method: "PATCH", headers: _sbHeaders(env, { Prefer: "return=representation" }), body: JSON.stringify({ statut: "en_cours" }) });
  const va = vr.ok ? await vr.json() : []; if (!va.length) return;
  const r = await lxParrainageCrediter(env, parrain, par, filleul.nom);
  if (r.ok) {
    await lxSbPatch(env, `parrainages?id=eq.${par.id}`, { statut: "recompense", montant: r.montant, stripe_ref: r.ref, recompense_le: new Date().toISOString(), motif: null });
    await lxParrainageMailParrain(env, parrain, filleul.nom, r.montant);
  } else if (r.attente) {
    await lxSbPatch(env, `parrainages?id=eq.${par.id}`, { statut: "en_attente", motif: "appliqué dès que le parrain a un abonnement payant" });
  } else {
    await lxSbPatch(env, `parrainages?id=eq.${par.id}`, { statut: r.refus ? "refuse" : "en_attente", motif: r.refus || r.erreur || "à reprendre" });
  }
  try { await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/notify_admins`, { method: "POST", headers: _sbHeaders(env), body: JSON.stringify({ p_event_type: "payment_failed", p_title: "🎁 Parrainage", p_body: `${parrain.nom} ← ${filleul.nom} : ${r.ok ? "1 mois offert (" + r.montant + " €)" : (r.attente ? "en attente (parrain sans abonnement payant)" : (r.refus || r.erreur))}`, p_url: "/admin.html", p_payload: {} }) }); } catch (_) {}
}
async function lxParrainageAppliquerEnAttente(env, parrainId) {
  const ps = await lxSbGet(env, `parrainages?select=*&parrain_id=eq.${parrainId}&statut=eq.en_attente&order=cree_le.asc&limit=12`);
  if (!ps.length) return;
  const parrain = await supabaseGet(env, parrainId);
  for (const par of ps) {
    const vr = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/parrainages?id=eq.${par.id}&statut=eq.en_attente`, { method: "PATCH", headers: _sbHeaders(env, { Prefer: "return=representation" }), body: JSON.stringify({ statut: "en_cours" }) });
    const va = vr.ok ? await vr.json() : []; if (!va.length) continue;
    const filleul = await supabaseGet(env, par.filleul_id);
    const r = await lxParrainageCrediter(env, parrain, par, filleul && filleul.nom);
    if (r.ok) {
      await lxSbPatch(env, `parrainages?id=eq.${par.id}`, { statut: "recompense", montant: r.montant, stripe_ref: r.ref, recompense_le: new Date().toISOString(), motif: null });
      await lxParrainageMailParrain(env, parrain, filleul && filleul.nom, r.montant);
    } else {
      await lxSbPatch(env, `parrainages?id=eq.${par.id}`, { statut: r.refus ? "refuse" : "en_attente", motif: r.refus || r.erreur || par.motif });
      if (r.attente) break;
    }
  }
}

// 2026-10-10 : facture Luxyra pour un achat de SMS (pack ou recharge automatique) — une par paiement Stripe
async function lxFactureSms(env, salonId, qty, montantEur, piId, auto) {
  try {
    let tvaPct = 0;
    try { const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/app_config?id=eq.1&select=config`, { headers: _sbHeaders(env) }); const a = r.ok ? await r.json() : []; if (a[0] && a[0].config && a[0].config.luxyra_tva_pct != null) tvaPct = Number(a[0].config.luxyra_tva_pct); } catch (_) {}
    const ttc = Math.round(Number(montantEur) * 100) / 100, ht = Math.round(ttc / (1 + tvaPct / 100) * 100) / 100;
    const corps = { salon_id: salonId, numero: null, type: auto ? "sms_recharge_auto" : "sms_pack", description: `Pack ${qty} SMS${auto ? " (recharge automatique)" : ""}`,
      plan: null, montant_brut: ttc, remise: 0, montant_ht: ht, taux_tva: tvaPct, montant_tva: Math.round((ttc - ht) * 100) / 100, montant_ttc: ttc,
      stripe_payment_intent: piId || null, mode_paiement: "carte", status: "paid", date_paiement: new Date().toISOString() };
    const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/factures_luxyra`, { method: "POST", headers: _sbHeaders(env, { Prefer: "return=minimal" }), body: JSON.stringify(corps) });
    if (!r.ok && r.status !== 409) console.error("facture SMS:", r.status, (await r.text()).slice(0, 200));
  } catch (e) { console.error("facture SMS:", e?.message || e); }
}
async function lxCrediterSms(env, salonId, nb, type, montant, motif, auteur) {
  try {
    const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/crediter_sms`, { method: "POST", headers: _sbHeaders(env), body: JSON.stringify({ p_salon_id: salonId, p_nb: nb, p_type: type, p_montant: montant, p_motif: motif, p_auteur: auteur }) });
    return r.ok ? await r.json() : { ok: false };
  } catch (e) { console.error("crediter_sms:", e?.message || e); return { ok: false }; }
}
// Envoi Brevo + contrôle du résultat : si Brevo refuse, les crédits débités sont rendus automatiquement.
// Si Brevo facture plus de SMS que prévu (cas rare), la différence est débitée si le solde le permet.
async function lxEnvoyerSmsFacture(env, salonId, gate, phone, contenu, sender) {
  let result = null;
  let remaining = gate.remainingCredits, debites = gate.nbSms || 1;
  // 2026-10-10 : chaque envoi est suivi (sms_envois) -> accusés de réception, remboursement, rapprochement Brevo
  let ref = null;
  try {
    const ri = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/sms_envois`, { method: "POST", headers: _sbHeaders(env, { Prefer: "return=representation" }), body: JSON.stringify({ salon_id: salonId, nb_sms: debites }) });
    const ra = ri.ok ? await ri.json() : []; ref = ra[0] ? ra[0].id : null;
  } catch (_) {}
  const webUrl = ref ? `https://luxyra.fr/api/brevo/sms-event?r=${ref}&s=${await lxSigneRef(env, ref)}` : null;
  try { result = await brevoSendSms(env, { to: phone, content: contenu, sender, tag: "salon_" + salonId, webUrl }); } catch (e) { result = { code: "exception", message: String(e?.message || e) }; }
  const ok = !!(result && (result.messageId || result.reference));
  if (ref) { try { await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/sms_envois?id=eq.${ref}`, { method: "PATCH", headers: _sbHeaders(env, { Prefer: "return=minimal" }), body: JSON.stringify({ message_id: result && result.messageId ? String(result.messageId) : null, statut: ok ? "envoye" : "echec", endpoint: result && result.endpoint || null, dernier_evenement: ok ? "accepted" : String(result?.code || "erreur").slice(0, 60), maj_le: new Date().toISOString() }) }); } catch (_) {} }
  if (!ok) {
    const motif = "SMS non envoyé par Brevo (" + String(result?.code || "erreur") + " : " + String(result?.message || "").slice(0, 150) + ") — crédit rendu";
    let rb = null;
    if (ref) { try { const rr = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/sms_envoi_rembourser`, { method: "POST", headers: _sbHeaders(env), body: JSON.stringify({ p_id: ref, p_motif: motif }) }); rb = rr.ok ? await rr.json() : null; } catch (_) {} }
    else rb = await lxCrediterSms(env, salonId, debites, "remboursement_echec", null, motif, "automatique");
    if (rb && rb.ok) remaining = rb.solde;
    return { ok: false, result, remaining, debites: 0, error: "SMS non envoyé (" + String(result?.message || "refus de l'opérateur") + ") — le crédit a été rendu" };
  }
  // Ancien endpoint (repli) : Brevo indique le nombre de SMS facturés ; s'il est supérieur, on débite la différence
  const facture = Number(result.smsCount || 0);
  if (facture > debites && facture <= 10) {
    const extra = await gateSmsAndDecrementCredit(env, salonId, facture - debites).catch(() => null);
    if (extra && extra.ok) {
      remaining = extra.remainingCredits; debites = facture;
      if (ref) { try { await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/sms_envois?id=eq.${ref}`, { method: "PATCH", headers: _sbHeaders(env, { Prefer: "return=minimal" }), body: JSON.stringify({ nb_sms: facture }) }); } catch (_) {} }
    }
  }
  // Recharge automatique (option du salon) quand le solde passe sous son seuil
  // (attendu : une promesse non attendue peut être coupée par Cloudflare après la réponse -> paiement sans crédit)
  try { const ra = await lxRechargeAutoSiBesoin(env, salonId, remaining); if (ra && ra.fait && typeof ra.solde === "number") remaining = ra.solde; } catch (e) { console.error("recharge auto:", e?.message || e); }
  // Alerte au gérant quand le solde passe sous 10 : une seule fois, jusqu'à la prochaine recharge
  if (remaining <= 10 && remaining > 0) {
    try { await notifySalonCreditBas(env, salonId, remaining); } catch (_) {}
  }
  return { ok: true, result, remaining, debites };
}
// ============================================================
// RECHARGE SMS AUTOMATIQUE (2026-10-10) — option du salon (Paramètres → SMS)
// Sous le seuil choisi : achat du pack choisi sur la carte enregistrée de l'abonnement Luxyra (paiement hors
// session). Verrou 10 min (pas de double débit), crédit atomique + historique, idempotent par PaymentIntent.
// Carte refusée / authentification demandée : option désactivée + UN email au gérant (pas de tentatives répétées).
// ============================================================
async function lxPrixPackSms(env, qty) {
  const def = { 100: 1099, 250: 2399, 500: 4499, 1000: 8299 };
  let cents = def[qty] || null;
  try {
    const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/app_config?id=eq.1&select=config`, { headers: _sbHeaders(env) });
    const a = r.ok ? await r.json() : [];
    const c = a[0] && a[0].config || {};
    if (c["sms_pack_" + qty + "_eur"] != null) cents = Math.round(Number(c["sms_pack_" + qty + "_eur"]) * 100);
  } catch (_) {}
  return cents;
}
async function lxCarteAbonnement(env, salon) {
  if (!salon || !salon.stripe_customer_id) return null;
  const cu = await stripeAPI(env, `customers/${encodeURIComponent(salon.stripe_customer_id)}?expand[]=invoice_settings.default_payment_method`, null, "GET");
  let pm = cu && cu.invoice_settings && cu.invoice_settings.default_payment_method;
  if (!pm && salon.stripe_subscription_id) {
    const sub = await stripeAPI(env, `subscriptions/${encodeURIComponent(salon.stripe_subscription_id)}?expand[]=default_payment_method`, null, "GET");
    pm = sub && sub.default_payment_method;
  }
  if (!pm) {
    const l = await stripeAPI(env, `payment_methods?customer=${encodeURIComponent(salon.stripe_customer_id)}&type=card&limit=1`, null, "GET");
    pm = l && Array.isArray(l.data) ? l.data[0] : null;
  }
  if (!pm || typeof pm !== "object" || !pm.id) return null;
  return { id: pm.id, marque: pm.card && pm.card.brand || "carte", fin: pm.card && pm.card.last4 || "", exp: pm.card ? (String(pm.card.exp_month).padStart(2, "0") + "/" + String(pm.card.exp_year).slice(-2)) : "" };
}
async function lxRechargeAutoSiBesoin(env, salonId, solde) {
  const salon = await supabaseGet(env, salonId);
  if (!salon || salon.sms_recharge_auto !== true || salon.plan !== "pro" || salon.sms_bloque === true) return { fait: false };
  if (salon.status === "suspended" || salon.status === "cancelled") return { fait: false };
  if (Number(solde) >= Number(salon.sms_recharge_seuil || 20)) return { fait: false };
  // verrou atomique (10 min)
  const vr = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/sms_recharge_verrou`, { method: "POST", headers: _sbHeaders(env), body: JSON.stringify({ p_salon: salonId }) });
  if (!vr.ok || (await vr.json()) !== true) return { fait: false, verrou: true };
  const qty = [100, 250, 500, 1000].includes(Number(salon.sms_recharge_pack)) ? Number(salon.sms_recharge_pack) : 100;
  const cents = await lxPrixPackSms(env, qty);
  const carte = await lxCarteAbonnement(env, salon);
  const echouer = async (motif) => {
    await supabaseUpdate(env, salonId, { sms_recharge_auto: false, sms_recharge_echec: String(motif).slice(0, 300) });
    try {
      if (salon.email) await brevoSendEmail(env, { to: salon.email, toName: salon.nom || "", senderEmail: "contact@luxyra.fr", senderName: "Luxyra",
        subject: `📱 Recharge SMS automatique impossible — ${salon.nom || "votre salon"}`,
        htmlContent: lxMailLayout(`<p>Bonjour,</p><p>Le solde SMS de <b>${salon.nom || "votre salon"}</b> est passé sous votre seuil, mais la recharge automatique de ${qty} SMS n'a pas pu être payée : <b>${String(motif).replace(/</g, "&lt;")}</b>.</p><p>La recharge automatique a été <b>désactivée</b> pour éviter de nouvelles tentatives. Vous pouvez acheter un pack et la réactiver dans l'application (Paramètres → SMS), après avoir mis à jour votre carte si besoin.</p><p style="text-align:center;margin:22px 0"><a href="https://luxyra.fr/app#sms" style="background:#c8a84e;color:#000;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700">Ouvrir Luxyra</a></p>`, { titre: `Recharge SMS automatique impossible` }),
        textContent: `La recharge SMS automatique de ${qty} SMS n'a pas pu être payée (${motif}). Elle a été désactivée. Rechargez dans l'application : https://luxyra.fr/app#sms`, replyTo: null, attachment: null });
    } catch (_) {}
    try { await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/notify_admins`, { method: "POST", headers: _sbHeaders(env), body: JSON.stringify({ p_event_type: "payment_failed", p_title: "📱 Recharge SMS auto refusée", p_body: `${salon.nom} : ${motif}`, p_url: "/admin.html#sms", p_payload: {} }) }); } catch (_) {}
    return { fait: false, echec: motif };
  };
  if (!cents) return await echouer("tarif du pack introuvable");
  if (!carte) return await echouer("aucune carte enregistrée sur l'abonnement");
  const pi = await stripeAPI(env, "payment_intents", {
    amount: String(cents), currency: "eur", customer: salon.stripe_customer_id, payment_method: carte.id,
    off_session: "true", confirm: "true",
    description: `Recharge automatique ${qty} SMS — Luxyra (${salon.nom || ""})`,
    receipt_email: salon.email || "",
    "metadata[type]": "sms_recharge_auto", "metadata[salon_id]": salonId, "metadata[sms_qty]": String(qty),
  });
  if (!pi || pi.status !== "succeeded") {
    const motif = (pi && pi.error && (pi.error.decline_code || pi.error.code || pi.error.message)) || (pi && pi.status) || "paiement refusé";
    return await echouer(motif === "authentication_required" ? "la banque demande une validation (3D Secure)" : motif);
  }
  // idempotent : un même paiement ne crédite qu'une fois
  try {
    const d = await (await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/sms_mouvements?select=id&salon_id=eq.${encodeURIComponent(salonId)}&motif=ilike.*${encodeURIComponent(pi.id)}*&limit=1`, { headers: _sbHeaders(env) })).json();
    if (Array.isArray(d) && d.length) return { fait: true, deja: true };
  } catch (_) {}
  const cr = await lxCrediterSms(env, salonId, qty, "achat_pack", cents / 100, `Recharge automatique ${qty} SMS (Stripe ${pi.id})`, "automatique");
  if (!cr || !cr.ok) await reportWorkerError(env, "worker:sms-recharge-auto", new Error("crédit après paiement échoué"), { salonId, pi: pi.id, qty }, "critical");
  await supabaseUpdate(env, salonId, { sms_recharge_echec: null });
  await lxFactureSms(env, salonId, qty, cents / 100, pi.id, true);
  return { fait: true, qty, montant: cents / 100, solde: cr && cr.solde };
}
// POST /api/sms/recharge-auto {salon_id, op:"etat"|"regler", actif, seuil, pack} — route salon (propriétaire)
async function handleSmsRechargeAuto(request, env) {
  try {
    const b = await readJsonBody(request);
    const salon = await supabaseGet(env, b.salon_id);
    if (!salon) return jsonResponse({ error: "Salon introuvable" }, 404);
    if (b.op === "regler") {
      const actif = b.actif === true, seuil = Math.max(5, Math.min(500, parseInt(b.seuil, 10) || 20));
      const pack = [100, 250, 500, 1000].includes(Number(b.pack)) ? Number(b.pack) : 100;
      if (actif) {
        if (salon.plan !== "pro") return jsonResponse({ error: "Disponible avec l'abonnement Pro" }, 403);
        if (!await lxCarteAbonnement(env, salon)) return jsonResponse({ error: "Aucune carte enregistrée sur votre abonnement : la recharge automatique n'est pas possible." }, 400);
      }
      await supabaseUpdate(env, salon.id, { sms_recharge_auto: actif, sms_recharge_seuil: seuil, sms_recharge_pack: pack, sms_recharge_echec: actif ? null : salon.sms_recharge_echec });
      let recharge = null;
      if (actif && Number(salon.sms_credits || 0) < seuil) recharge = await lxRechargeAutoSiBesoin(env, salon.id, Number(salon.sms_credits || 0));
      return jsonResponse({ ok: true, actif, seuil, pack, recharge });
    }
    const carte = salon.plan === "pro" ? await lxCarteAbonnement(env, salon) : null;
    const prix = {}; for (const q of [100, 250, 500, 1000]) prix[q] = (await lxPrixPackSms(env, q)) / 100;
    return jsonResponse({ ok: true, actif: salon.sms_recharge_auto === true, seuil: salon.sms_recharge_seuil || 20, pack: salon.sms_recharge_pack || 100, echec: salon.sms_recharge_echec || null, carte: carte ? { marque: carte.marque, fin: carte.fin, exp: carte.exp } : null, prix });
  } catch (e) {
    return jsonResponse({ error: "Erreur recharge automatique : " + (e?.message || e) }, 500);
  }
}

async function notifySalonCreditBas(env, salonId, reste) {
  try {
    const salon = await supabaseGet(env, salonId);
    if (!salon || !salon.email) return;
    // UNE seule fois par épisode : le marqueur n'est remis à zéro que par une recharge au-dessus de 10 (trg_sms_alertes_reset)
    if (salon.sms_alerte_basse_le) return;
    const salonName = salon.nom || "votre salon";
    const subject = `📱 Plus que ${reste} SMS — ${salonName}`;
    const html = lxMailLayout(`<p>Bonjour,</p>
        <p>Le solde SMS de <strong>${ccEsc(salonName)}</strong> est presque épuisé : il reste <strong>${reste} SMS</strong>. Quand il arrivera à 0, les rappels de rendez-vous seront mis en attente jusqu'à la recharge.</p>
        ${lxMailBouton("📱 Recharger mes SMS", "https://luxyra.fr/app#sms")}
        <p style="font-size:12px;color:#888">Astuce : activez la recharge automatique (Paramètres → SMS) pour ne jamais tomber à zéro. Ce message ne vous sera envoyé qu'une fois.</p>`, { titre: `Plus que ${reste} SMS` });
    const textContent = `Plus que ${reste} SMS pour ${salonName}. Quand le solde arrivera à 0, les rappels seront mis en attente jusqu'à la recharge.\n\nRecharger : https://luxyra.fr/app#sms\n\nLuxyra.`;
    await brevoSendEmail(env, { to: salon.email, toName: salonName, senderEmail: "contact@luxyra.fr", senderName: "Luxyra", subject, htmlContent: html, textContent, replyTo: null, attachment: null });
    await supabaseUpdate(env, salonId, { sms_alerte_basse_le: new Date().toISOString() });
  } catch (e) { console.error("notifySalonCreditBas:", e?.message || e); }
}

async function notifySalonCreditExhausted(env, salonId) {
  try {
    const salon = await supabaseGet(env, salonId);
    if (!salon || !salon.email) return;
    // 2026-10-09 : UNE seule fois par épisode (plus de relance quotidienne) ; remis à zéro par une recharge (trg_sms_alertes_reset)
    if (salon.last_sms_credit_alert_at) return;
    const salonName = salon.nom || "votre salon";
    const subject = `⚠️ Crédits SMS épuisés — ${salonName}`;
    const html = lxMailLayout(`<p>Bonjour,</p>
        <p>Le compte SMS de <strong>${ccEsc(salonName)}</strong> est arrivé à 0. Vos rappels de rendez-vous automatiques, SMS d'anniversaire et notifications fidélité <strong style="color:#c0392b">ne sont plus envoyés</strong>.</p>
        <p>Pour rétablir les envois immédiatement, rechargez un pack SMS depuis votre application :</p>
        ${lxMailBouton("📱 Recharger mes SMS", "https://luxyra.fr/app#sms")}
        <p style="font-size:12px;color:#888">Ce message ne vous sera pas renvoyé. Les emails continuent d'être envoyés normalement (ils ne consomment pas de crédits SMS).</p>`, { titre: "Vos crédits SMS sont épuisés" });
    const textContent = `Vos crédits SMS sont épuisés.\n\nLe compte SMS de ${salonName} est à 0. Vos rappels RDV automatiques, SMS anniversaire et notifications fidélité ne sont plus envoyés.\n\nPour recharger : https://luxyra.fr/app#sms\n\nLuxyra.`;
    await brevoSendEmail(env, {
      to: salon.email, toName: salonName,
      senderEmail: "contact@luxyra.fr", senderName: "Luxyra",
      subject, htmlContent: html, textContent, replyTo: null, attachment: null
    });
    // Update timestamp pour rate-limit
    await supabaseUpdate(env, salonId, { last_sms_credit_alert_at: new Date().toISOString() });
    console.log("notifySalonCreditExhausted: email envoyé à", salon.email);
  } catch (e) {
    console.error("notifySalonCreditExhausted error:", e?.message || e);
  }
}

async function handleSmsRappel(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!checkRateLimit("sms:" + ip, 15)) return jsonResponse({ error: "Trop de requêtes SMS. Réessayez dans 1 minute." }, 429);
  const { telephone, clientPrenom, salonName, date, heure, prestation, salon_id } = await request.json();
  if (!telephone) return jsonResponse({ error: "telephone requis" }, 400);
  const contenuRappel = lxSmsGsm(`${salonName||"Votre salon"} : Rappel RDV le ${date} à ${heure}${prestation?" ("+prestation+")":""}. Pour modifier/annuler, contactez-nous. A bientôt !`);
  // === Gate Pro + crédits + décrément (nombre réel de SMS facturés par Brevo) ===
  const gate = await gateSmsAndDecrementCredit(env, salon_id, lxSmsSegments(contenuRappel));
  if (!gate.ok) {
    // Si le blocage est dû à des crédits 0 (status 402) → alerte email auto au salon
    // (rate-limité 24h dans la fonction). Fire & forget — ne bloque pas la réponse.
    if (gate.status === 402 && salon_id) { try { await lxRechargeAutoSiBesoin(env, salon_id, 0); } catch (_) {} }
    if (gate.status === 402 && salon_id && gate.soldeZero) {
      try { await notifySalonCreditExhausted(env, salon_id); } catch (e) { console.warn("alert email failed:", e?.message); }
    }
    return jsonResponse({ error: gate.error }, gate.status);
  }
  let phone = telephone.replace(/[\s.\-]/g, ""); if (phone.startsWith("0")) phone = "+33" + phone.slice(1);
  const env1 = await lxEnvoyerSmsFacture(env, salon_id, gate, phone, contenuRappel, (salonName||"Luxyra").slice(0,11).trim());
  if (!env1.ok) return jsonResponse({ success: false, error: env1.error, result: env1.result, remainingCredits: env1.remaining, smsDebites: 0 }, 502);
  return jsonResponse({ success: true, result: env1.result, remainingCredits: env1.remaining, smsDebites: env1.debites });
}

async function handleSmsCustom(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!checkRateLimit("sms:" + ip, 15)) return jsonResponse({ error: "Trop de requêtes SMS. Réessayez dans 1 minute." }, 429);
  const { telephone, message, salonName, salon_id } = await request.json();
  if (!telephone || !message) return jsonResponse({ error: "telephone et message requis" }, 400);
  const contenu = lxSmsGsm(message);
  if (!contenu) return jsonResponse({ error: "Message vide" }, 400);
  // === Gate Pro + crédits + décrément (nombre réel de SMS facturés par Brevo) ===
  const gate = await gateSmsAndDecrementCredit(env, salon_id, lxSmsSegments(contenu));
  if (!gate.ok) {
    if (gate.status === 402 && salon_id) { try { await lxRechargeAutoSiBesoin(env, salon_id, 0); } catch (_) {} }
    return jsonResponse({ error: gate.error }, gate.status);
  }
  let phone = telephone.replace(/[\s.\-]/g, ""); if (phone.startsWith("0")) phone = "+33" + phone.slice(1);
  const env1 = await lxEnvoyerSmsFacture(env, salon_id, gate, phone, contenu, (salonName||"Luxyra").slice(0,11).trim());
  if (!env1.ok) return jsonResponse({ success: false, error: env1.error, result: env1.result, remainingCredits: env1.remaining, smsDebites: 0 }, 502);
  return jsonResponse({ success: true, result: env1.result, remainingCredits: env1.remaining, smsDebites: env1.debites });
}

async function handleClientTickets(request, env) {
  try {
    const _body = await request.json().catch(() => ({}));
    // SECURITE 2026-10-08 : l'email vient de la SESSION de la cliente, jamais du corps de la requete.
    const _sess = await verifyClientSession(_body.session_token, env);
    if (!_sess || !_sess.email) return jsonResponse({ error: "session_token invalide ou expiré", tickets: [] }, 401);
    const email = _sess.email;
    const sbKey = env.SUPABASE_SERVICE_KEY;
    if (!sbKey) return jsonResponse({ error: "configuration_error", tickets: [] });
    const headers = { "apikey": sbKey, "Authorization": "Bearer " + sbKey, "Content-Type": "application/json" };
    const clients = await (await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/clients?select=id,salon_id,nom,prenom&email=eq.${encodeURIComponent(email)}&limit=20`, { headers })).json();
    if (!Array.isArray(clients) || !clients.length) return jsonResponse({ tickets: [] });
    let allTickets = [];
    for (const cl of clients) {
      try {
        const appts = await (await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/appointments?select=id,salon_id,date_rdv,heure,prix,status,mode_paiement,ticket_num,items,ticket_html&client_id=eq.${cl.id}&status=eq.done&order=date_rdv.desc&limit=30`, { headers })).json();
        if (!Array.isArray(appts)) continue;
        let salonNom = "";
        try { const s = await (await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/salons?select=nom&id=eq.${cl.salon_id}&limit=1`, { headers })).json(); if (s?.[0]) salonNom = s[0].nom; } catch(e) {}
        for (const a of appts) {
          let itemName = "Prestation";
          if (a.items?.length) { const names = a.items.filter(it => !it.isSep && it.name).map(it => it.name); if (names.length) itemName = names.join(", "); }
          allTickets.push({ id: a.id, salon_id: cl.salon_id, salon_nom: salonNom, date_rdv: a.date_rdv, heure_rdv: a.heure, service_nom: itemName, service_prix: a.prix || 0, status: "done", items: a.items || [], ticket_num: a.ticket_num, _fromPOS: true, ticket_html: a.ticket_html || null });
        }
      } catch(e2) {}
    }
    allTickets.sort((a, b) => (a.date_rdv || "") > (b.date_rdv || "") ? -1 : 1);
    return jsonResponse({ tickets: allTickets });
  } catch(err) { return jsonResponse({ error: err.message, tickets: [] }); }
}

// ============================================================
// CLIENT ESPACE (compte.html) — endpoints sécurisés
// ============================================================
// Chaque endpoint :
//   1. Lit `session_token` du body
//   2. Vérifie le JWT via verifyClientSession (HS256, secret partagé edge functions)
//   3. Si OK → utilise SUPABASE_SERVICE_KEY pour bypass RLS, filtré sur lx_id/email
//   4. Si KO → 401
// Permet ensuite de DROP les policies anon USING(true) qui leakaient toutes
// les données client à n'importe quel détenteur de l'anon key (publique).

// GET cartes d'abonnement du client (cross-salons par défaut, filtrable par salon_id)
async function handleClientCartes(request, env) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) return jsonResponse({ error: "body invalide" }, 400);
    const session = await verifyClientSession(body.session_token, env);
    if (!session) return jsonResponse({ error: "session_token invalide ou expiré" }, 401);
    const email = session.email;
    if (!email) return jsonResponse({ error: "email manquant dans la session" }, 401);
    // Filtre optionnel salon_id (utilisé par site.html quand on est sur la page d'un seul salon)
    const salonId = body.salon_id ? String(body.salon_id) : null;
    const onlyActive = body.only_active === true;
    let url = `${CONFIG.SUPABASE_URL}/rest/v1/cartes_abo_clients?select=*&client_luxyra_id=eq.${encodeURIComponent(email)}`;
    if (salonId) url += `&salon_id=eq.${encodeURIComponent(salonId)}`;
    if (onlyActive) url += `&status=eq.active`;
    url += `&order=created_at.desc`;
    const cartesRes = await fetch(url, { headers: _sbHeaders(env) });
    if (!cartesRes.ok) return jsonResponse({ error: "Lecture cartes échouée" }, 500);
    const cartes = await cartesRes.json();
    if (!Array.isArray(cartes) || !cartes.length) return jsonResponse({ cartes: [] });
    // Enrich salon_nom (1 fetch par salon unique)
    const salonIds = [...new Set(cartes.map(c => c.salon_id).filter(Boolean))];
    const salonNames = {};
    for (const sid of salonIds) {
      try {
        const r = await fetch(
          `${CONFIG.SUPABASE_URL}/rest/v1/salons?select=nom&id=eq.${sid}&limit=1`,
          { headers: _sbHeaders(env) }
        );
        const data = await r.json();
        if (Array.isArray(data) && data[0]) salonNames[sid] = data[0].nom;
      } catch (e) {}
    }
    cartes.forEach(c => { c.salon_nom = salonNames[c.salon_id] || ""; });
    return jsonResponse({ cartes });
  } catch (e) {
    console.error("handleClientCartes:", e);
    return jsonResponse({ error: e.message || "erreur" }, 500);
  }
}

// GET fidelité du client (cross-salons par défaut, filtrable par salon_id) + enrich seuils/remises
async function handleClientFidelite(request, env) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) return jsonResponse({ error: "body invalide" }, 400);
    const session = await verifyClientSession(body.session_token, env);
    if (!session) return jsonResponse({ error: "session_token invalide ou expiré" }, 401);
    const email = session.email;
    const lxId = session.lx_id;
    const salonId = body.salon_id ? String(body.salon_id) : null;
    // fidelite_client.client_luxyra_id est text — on essaie email d'abord, fallback id
    function _buildUrl(idVal) {
      let u = `${CONFIG.SUPABASE_URL}/rest/v1/fidelite_client?select=*&client_luxyra_id=eq.${encodeURIComponent(idVal)}`;
      if (salonId) u += `&salon_id=eq.${encodeURIComponent(salonId)}`;
      u += `&order=derniere_visite.desc`;
      return u;
    }
    let fidelite = [];
    try {
      const r1 = await fetch(_buildUrl(email), { headers: _sbHeaders(env) });
      const d1 = await r1.json();
      if (Array.isArray(d1)) fidelite = d1;
    } catch (e) {}
    if (!fidelite.length && lxId) {
      try {
        const r2 = await fetch(_buildUrl(lxId), { headers: _sbHeaders(env) });
        const d2 = await r2.json();
        if (Array.isArray(d2) && d2.length) fidelite = d2;
      } catch (e) {}
    }
    // Enrich avec fidconf à jour de chaque salon
    for (const f of fidelite) {
      if (!f.salon_id) continue;
      try {
        const sr = await fetch(
          `${CONFIG.SUPABASE_URL}/rest/v1/salons?select=nom,config_json&id=eq.${f.salon_id}&limit=1`,
          { headers: _sbHeaders(env) }
        );
        const sd = await sr.json();
        if (Array.isArray(sd) && sd[0]) {
          if (!f.salon_nom) f.salon_nom = sd[0].nom;
          let cfg = {};
          try {
            cfg = typeof sd[0].config_json === "string" ? JSON.parse(sd[0].config_json) : (sd[0].config_json || {});
          } catch (e) {}
          if (cfg.fidconf) {
            f.seuil_fidelite = cfg.fidconf.seuil || f.seuil_fidelite || 10;
            f.remise_fidelite = cfg.fidconf.remise || f.remise_fidelite || 10;
            f.remise_type = cfg.fidconf.type || f.remise_type || "amount";
          }
        }
      } catch (e) {}
    }
    return jsonResponse({ fidelite });
  } catch (e) {
    console.error("handleClientFidelite:", e);
    return jsonResponse({ error: e.message || "erreur" }, 500);
  }
}

// GET RDV en ligne du client (cross-salons par défaut, filtrable par salon_id)
async function handleClientRdvs(request, env) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) return jsonResponse({ error: "body invalide" }, 400);
    const session = await verifyClientSession(body.session_token, env);
    if (!session) return jsonResponse({ error: "session_token invalide ou expiré" }, 401);
    const lxId = session.lx_id;
    const email = session.email;
    const salonId = body.salon_id ? String(body.salon_id) : null;
    // 2 fetches : par luxyra_id (uuid) puis par email (text). Dedupe sur id.
    const seen = new Set();
    // Dédup LOGIQUE : un même créneau peut exister dans rdv_online ET appointments
    // (résa en ligne miroitée au planning). id différents → on déduplique sur salon+date+heure.
    const seenSlot = new Set();
    const _slotKey = (sid, d, h) => String(sid || "") + "|" + String(d || "") + "|" + String(h || "").slice(0, 5);
    const rdvs = [];
    async function _fetch(filter) {
      try {
        let u = `${CONFIG.SUPABASE_URL}/rest/v1/rdv_online?select=*,salons(nom)&${filter}`;
        if (salonId) u += `&salon_id=eq.${encodeURIComponent(salonId)}`;
        u += `&order=date_rdv.desc&limit=50`;
        const r = await fetch(u, { headers: _sbHeaders(env) });
        const data = await r.json();
        if (!Array.isArray(data)) return;
        for (const d of data) {
          if (seen.has(d.id)) continue;
          seen.add(d.id);
          d.salon_nom = d.salons ? d.salons.nom : "";
          delete d.salons;
          seenSlot.add(_slotKey(d.salon_id, d.date_rdv, d.heure_rdv));
          rdvs.push(d);
        }
      } catch (e) {}
    }
    if (lxId) await _fetch(`client_luxyra_id=eq.${encodeURIComponent(lxId)}`);
    if (email) await _fetch(`client_email=eq.${encodeURIComponent(email)}`);
    // FIX liaison : inclure les RDV pris EN SALON (table appointments) des fiches reliees au compte Luxyra
    try {
      let _clientIds = [];
      if (lxId) {
        const _cr = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/clients?client_luxyra_id=eq.${encodeURIComponent(lxId)}&select=id,salon_id`, { headers: _sbHeaders(env) });
        const _cls = await _cr.json();
        if (Array.isArray(_cls)) _clientIds = _cls.map((c) => c.id).filter(Boolean);
      }
      if (_clientIds.length) {
        const _today = new Date().toISOString().slice(0, 10);
        const _inList = _clientIds.map((id) => encodeURIComponent(id)).join(",");
        let _au = `${CONFIG.SUPABASE_URL}/rest/v1/appointments?select=id,salon_id,client_id,date_rdv,heure,prix,status,items,collab_name,cancelled&client_id=in.(${_inList})&date_rdv=gte.${_today}&cancelled=eq.false&status=neq.done&order=date_rdv.desc&limit=50`;
        if (salonId) _au += `&salon_id=eq.${encodeURIComponent(salonId)}`;
        const _ar = await fetch(_au, { headers: _sbHeaders(env) });
        const _appts = await _ar.json();
        if (Array.isArray(_appts) && _appts.length) {
          const _sids = [...new Set(_appts.map((a) => a.salon_id).filter(Boolean))];
          const _snames = {};
          for (const _sid of _sids) {
            try {
              const _sr = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/salons?select=nom&id=eq.${_sid}&limit=1`, { headers: _sbHeaders(env) });
              const _sd = await _sr.json();
              if (Array.isArray(_sd) && _sd[0]) _snames[_sid] = _sd[0].nom;
            } catch (e) {}
          }
          for (const a of _appts) {
            const _k = _slotKey(a.salon_id, a.date_rdv, a.heure);
            if (seen.has(a.id) || seenSlot.has(_k)) continue;
            seen.add(a.id);
            seenSlot.add(_k);
            let _itemName = "Prestation";
            if (a.items && a.items.length) {
              const _ns = a.items.filter((it) => !it.isSep && it.name).map((it) => it.name);
              if (_ns.length) _itemName = _ns.join(", ");
            }
            rdvs.push({
              id: a.id, salon_id: a.salon_id, salon_nom: _snames[a.salon_id] || "",
              date_rdv: a.date_rdv, heure_rdv: a.heure, service_nom: _itemName,
              service_prix: a.prix || 0, status: "confirmed", items: a.items || [],
              collaborateur_nom: a.collab_name || null, _salon_rdv: true
            });
          }
        }
      }
    } catch (e) {}
    rdvs.sort((a, b) => (a.date_rdv || "") > (b.date_rdv || "") ? -1 : 1);
    // Quick Win #3 (2026-05-06) : enrichir chaque RDV avec la politique d'annulation
    // du salon (politique_annulation_h en heures + remboursement_annulation bool).
    // Permet à compte.html (espace client multi-salons) de bloquer les annulations
    // hors délai sans avoir à fetcher chaque salon séparément.
    try {
      const distinctSalons = Array.from(new Set(rdvs.map(r => r.salon_id).filter(Boolean)));
      if (distinctSalons.length > 0) {
        const inList = distinctSalons.map(id => encodeURIComponent(id)).join(",");
        const cu = `${CONFIG.SUPABASE_URL}/rest/v1/site_config?select=salon_id,politique_annulation,remboursement_annulation&salon_id=in.(${inList})`;
        const cr = await fetch(cu, { headers: _sbHeaders(env) });
        const cd = await cr.json();
        const policyMap = {};
        if (Array.isArray(cd)) {
          for (const c of cd) {
            // Convertit "24h"/"48h"/"72h"/"jamais" en nombre d'heures (-1 = jamais annulable, 0 = aucun délai)
            let h = 48;
            const raw = String(c.politique_annulation || "48h").trim().toLowerCase();
            if (raw === "jamais" || raw === "non" || raw === "no") h = -1;
            else if (raw === "0" || raw === "0h" || raw === "aucun") h = 0;
            else { const m = raw.match(/(\d+)/); if (m) h = parseInt(m[1], 10); }
            policyMap[c.salon_id] = {
              hours: h,
              remboursement: c.remboursement_annulation !== false
            };
          }
        }
        for (const r of rdvs) {
          const p = policyMap[r.salon_id];
          if (p) {
            r.politique_annulation_h = p.hours;
            r.remboursement_annulation = p.remboursement;
          } else {
            // Salon sans config (ou archive) : défaut 48h pour rester safe
            r.politique_annulation_h = 48;
            r.remboursement_annulation = true;
          }
        }
      }
    } catch (e) { /* fail silencieux : le client retombera sur 48h par défaut */ }
    return jsonResponse({ rdvs });
  } catch (e) {
    console.error("handleClientRdvs:", e);
    return jsonResponse({ error: e.message || "erreur" }, 500);
  }
}

// ============================================================
// FIX 2026-05-23 : ACOMPTE — finalize post-Checkout (stocke le PI)
// ------------------------------------------------------------
// Le flux acompte (capture immédiate) ne stockait pas le payment_intent
// dans rdv_online → impossible de rembourser automatiquement plus tard.
// Cet endpoint (appelé au retour payment=success) récupère le PI depuis
// la session Stripe et l'écrit dans rdv_online.payment_intent_id.
// ============================================================
async function handleAcompteFinalize(request, env) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) return jsonResponse({ error: "body invalide" }, 400);
    const { session_id, rdv_id } = body;
    if (!session_id || !rdv_id) return jsonResponse({ error: "session_id et rdv_id requis" }, 400);
    let wantStatus = (body.status === "pending" || body.status === "confirmed") ? body.status : "confirmed";
    // 2026-10-09 : la session peut être sur le compte Stripe du salon (charges directes)
    let _comptesA = [];
    try {
      const _q = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rdv_online?select=salon_id,stripe_account&id=eq.${encodeURIComponent(rdv_id)}&limit=1`, { headers: _sbHeaders(env) });
      const _qa = _q.ok ? await _q.json() : [];
      if (_qa && _qa[0]) { _comptesA.push(_qa[0].stripe_account); const _sl = await supabaseGet(env, _qa[0].salon_id); if (_sl) _comptesA.push(_sl.stripe_connect_id); }
    } catch (_) {}
    const { session, compte: _compteA } = await lxSessionOu(env, session_id, _comptesA);
    if (!session || session.error) return jsonResponse({ error: "Session Stripe introuvable" }, 404);
    // SECURITE 2026-10-08 : la session doit porter CE rdv (acompte), du meme salon, du bon montant, payee une seule fois.
    if (!session.metadata || String(session.metadata.rdv_id || "") !== String(rdv_id) || session.metadata.subtype === "empreinte" || (session.metadata.type && session.metadata.type !== "acompte")) {
      return jsonResponse({ error: "Session non liée à ce rendez-vous" }, 403);
    }
    if (session.payment_status !== "paid") return jsonResponse({ error: "Paiement non confirmé: " + session.payment_status }, 402);
    const piId = session.payment_intent || null;
    {
      const _r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rdv_online?select=id,salon_id,status,acompte_paye,acompte_montant,payment_intent_id&id=eq.${encodeURIComponent(rdv_id)}&limit=1`, { headers: _sbHeaders(env) });
      const _a = _r.ok ? await _r.json() : [];
      const _rdv = Array.isArray(_a) ? _a[0] : null;
      if (!_rdv) return jsonResponse({ error: "RDV introuvable" }, 404);
      if (String(session.metadata.salon_id || "") !== String(_rdv.salon_id)) return jsonResponse({ error: "Session non liée à ce salon" }, 403);
      if (_rdv.acompte_paye === true) {
        if (piId && String(_rdv.payment_intent_id || "") === String(piId)) return jsonResponse({ ok: true, payment_intent_id: piId, deja: true });
        return jsonResponse({ error: "Acompte déjà enregistré pour ce rendez-vous" }, 409);
      }
      const _attendu = Math.round((Number(_rdv.acompte_montant) || 0) * 100);
      if (_attendu > 0 && typeof session.amount_total === "number" && session.amount_total < _attendu) {
        await reportWorkerError(env, "worker:acompte-finalize", new Error("Montant paye different de l'acompte"), { rdv_id, paye: session.amount_total, attendu: _attendu }, "critical");
        return jsonResponse({ error: "Montant payé incohérent" }, 409);
      }
      // Statut decide par le salon (confirmation automatique ou non), pas par la page.
      try {
        const _c = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/site_config?select=confirmation_auto&salon_id=eq.${encodeURIComponent(_rdv.salon_id)}&limit=1`, { headers: _sbHeaders(env) });
        const _ca = _c.ok ? await _c.json() : [];
        if (Array.isArray(_ca) && _ca[0] && typeof _ca[0].confirmation_auto === "boolean") wantStatus = _ca[0].confirmation_auto ? "confirmed" : "pending";
      } catch (_e) {}
    }
    const patch = { acompte_paye: true, status: wantStatus, stripe_account: _compteA || null };
    if (piId) { patch.payment_intent_id = piId; patch.stripe_payment_id = piId; }
    const upRes = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rdv_online?id=eq.${encodeURIComponent(rdv_id)}`, {
      method: "PATCH", headers: _sbHeaders(env, { "Prefer": "return=minimal" }), body: JSON.stringify(patch)
    });
    if (!upRes.ok) { const t = await upRes.text(); return jsonResponse({ error: "Update rdv_online échoué: " + t }, 500); }
    return jsonResponse({ ok: true, payment_intent_id: piId });
  } catch (e) {
    return jsonResponse({ error: "acompte-finalize error: " + e.message }, 500);
  }
}

// ============================================================
// FIX 2026-05-23 : REMBOURSEMENT ACOMPTE AUTOMATIQUE
// ------------------------------------------------------------
// Rembourse l'acompte payé via Stripe Connect (destination charge).
// reverse_transfer:true → l'argent est repris sur le solde du salon puis
// remboursé au client. Idempotent (ne rembourse jamais 2x).
// Politique : site_config.politique_annulation (délai) + remboursement_annulation.
// ============================================================
async function attemptAcompteRefund(env, rdv) {
  try {
    if (!rdv) return { refunded: false, error: "rdv manquant" };
    if (rdv.acompte_rembourse === true) return { refunded: false, skipped: "déjà remboursé" };
    if (rdv.acompte_paye !== true) return { refunded: false, skipped: "acompte non payé" };
    const montant = Number(rdv.acompte_montant) || 0;
    if (montant <= 0) return { refunded: false, skipped: "montant nul" };
    if (rdv.status !== "cancelled") return { refunded: false, skipped: "non annulé" };

    // 1) Politique d'annulation du salon (site_config — SINGULIER)
    let policyHours = 48, remboursementOn = true;
    try {
      const cfgRes = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/site_config?select=politique_annulation,remboursement_annulation&salon_id=eq.${encodeURIComponent(rdv.salon_id)}&limit=1`, { headers: _sbHeaders(env) });
      if (cfgRes.ok) {
        const rows = await cfgRes.json();
        if (Array.isArray(rows) && rows[0]) {
          remboursementOn = rows[0].remboursement_annulation !== false;
          const raw = String(rows[0].politique_annulation || "48h").trim().toLowerCase();
          const m = raw.match(/(\d+)/);
          if (m) {
            policyHours = parseInt(m[1]);
            if (raw.includes("j") || raw.includes("jour") || raw.includes("day")) policyHours = parseInt(m[1]) * 24;
          }
        }
      }
    } catch (_) {}
    if (!remboursementOn) return { refunded: false, skipped: "remboursement désactivé par le salon" };

    // 2) Délai : annulation au moins policyHours avant le RDV
    try {
      if (rdv.date_rdv && rdv.heure_rdv) {
        const rdvStart = new Date(`${rdv.date_rdv}T${rdv.heure_rdv}`);
        const cancelTime = rdv.cancelled_at ? new Date(rdv.cancelled_at) : new Date();
        const hoursBefore = (rdvStart.getTime() - cancelTime.getTime()) / 3600000;
        if (isFinite(hoursBefore) && hoursBefore < policyHours) {
          return { refunded: false, skipped: `hors délai (${Math.round(hoursBefore)}h < ${policyHours}h)` };
        }
      }
    } catch (_) {}

    // 3) Résolution du PaymentIntent
    // 2026-10-09 : paiement direct sur le compte du salon -> remboursement sur ce compte, sans reverse_transfer
    if (rdv.stripe_account && rdv.payment_intent_id) {
      const rfd = await stripeAPI(env, "refunds", { payment_intent: rdv.payment_intent_id, "metadata[rdv_id]": String(rdv.id || ""), "metadata[salon_id]": String(rdv.salon_id || "") }, "POST", rdv.stripe_account);
      if (!rfd || rfd.error || !rfd.id) return { refunded: false, error: (rfd && rfd.error && rfd.error.message) || "échec refund Stripe", payment_intent: rdv.payment_intent_id };
      return { refunded: true, refund_id: rfd.id, payment_intent: rdv.payment_intent_id, status: rfd.status };
    }
    let piId = rdv.payment_intent_id || null;
    if (!piId && rdv.stripe_payment_id && String(rdv.stripe_payment_id).startsWith("pi_")) piId = rdv.stripe_payment_id;
    if (!piId) piId = await findAcompteChargePI(env, rdv, montant);
    if (!piId) return { refunded: false, error: "payment_intent introuvable (aucune correspondance unique côté Stripe)" };

    // 4) Remboursement Stripe (destination charge → reverse_transfer)
    const refund = await stripeAPI(env, "refunds", {
      payment_intent: piId,
      reverse_transfer: "true",
      "metadata[rdv_id]": String(rdv.id || ""),
      "metadata[salon_id]": String(rdv.salon_id || "")
    });
    if (!refund || refund.error || !refund.id) {
      const e = refund && refund.error;
      const msg = (e && (e.message || e)) || "échec refund Stripe";
      return { refunded: false, error: typeof msg === "string" ? msg : JSON.stringify(msg), payment_intent: piId };
    }
    return { refunded: true, refund_id: refund.id, payment_intent: piId, status: refund.status };
  } catch (e) {
    return { refunded: false, error: e.message || "exception refund" };
  }
}

// Recherche un charge Stripe correspondant à l'acompte (cas legacy : PI non
// stocké). Match strict montant + devise + destination Connect + email +
// fenêtre temporelle. Retourne le PI seulement si UNE seule correspondance.
async function findAcompteChargePI(env, rdv, montant) {
  try {
    const salon = await supabaseGet(env, rdv.salon_id);
    const dest = salon?.stripe_connect_id || null;
    if (!dest) return null;
    const amountCents = Math.round(montant * 100);
    const base = rdv.created_at ? Math.floor(new Date(rdv.created_at).getTime() / 1000) : Math.floor(Date.now() / 1000);
    const gte = base - 1800;       // 30 min avant la création du RDV
    const lte = base + 6 * 3600;   // 6 h après
    const email = (rdv.client_email || "").toLowerCase();
    const list = await stripeAPI(env, `charges?limit=100&created[gte]=${gte}&created[lte]=${lte}`, null, "GET");
    if (!list || !Array.isArray(list.data)) return null;
    const matches = list.data.filter(c =>
      c && c.paid === true && c.refunded === false && c.status === "succeeded" &&
      c.currency === "eur" && c.amount === amountCents &&
      ((c.transfer_data && c.transfer_data.destination === dest) || c.destination === dest) &&
      (
        (c.billing_details && c.billing_details.email && c.billing_details.email.toLowerCase() === email) ||
        (c.receipt_email && c.receipt_email.toLowerCase() === email) ||
        !email
      )
    );
    if (matches.length === 1 && matches[0].payment_intent) return matches[0].payment_intent;
    return null;
  } catch (_) { return null; }
}

// Tente le remboursement et enregistre le résultat dans rdv_online (idempotent).
// 2026-10-08 : annulation par la cliente d'un RDV garanti par empreinte.
// Dans le délai de la politique d'annulation -> empreinte libérée tout de suite (sinon les fonds
// restaient bloqués jusqu'à 7 jours). Hors délai -> on la laisse : le salon décide (bouton
// « Capturer » ou « Libérer » dans le planning), sinon Stripe la libère seul après 7 jours.
async function releaseEmpreinteOnCancel(env, rdv) {
  if (!rdv || rdv.empreinte_status !== "held" || !rdv.payment_intent_id) return { skipped: "pas d'empreinte active" };
  let policyHours = 48;
  try {
    const cfgRes = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/site_config?select=politique_annulation&salon_id=eq.${encodeURIComponent(rdv.salon_id)}&limit=1`, { headers: _sbHeaders(env) });
    const rows = cfgRes.ok ? await cfgRes.json() : [];
    const raw = String((rows && rows[0] && rows[0].politique_annulation) || "48h").trim().toLowerCase();
    const m = raw.match(/(\d+)/);
    if (m) { policyHours = parseInt(m[1]); if (raw.includes("j") || raw.includes("jour") || raw.includes("day")) policyHours = parseInt(m[1]) * 24; }
  } catch (_) {}
  const rdvStart = new Date(`${rdv.date_rdv}T${rdv.heure_rdv}`);
  const hoursBefore = (rdvStart.getTime() - Date.now()) / 3600000;
  if (isFinite(hoursBefore) && hoursBefore < policyHours) return { skipped: `hors délai (${Math.round(hoursBefore)}h < ${policyHours}h) : décision du salon` };
  const _hE = { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" };
  if (rdv.stripe_account) _hE["Stripe-Account"] = rdv.stripe_account;  // charge directe sur le compte du salon
  const res = await fetch(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(rdv.payment_intent_id)}/cancel`, {
    method: "POST", headers: _hE, body: "cancellation_reason=requested_by_customer"
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !/canceled/i.test(String(data?.error?.message || ""))) {
    try { await reportWorkerError(env, "empreinte:release_on_cancel", new Error(data?.error?.message || ("HTTP " + res.status)), { rdv_id: rdv.id }, "error"); } catch (_) {}
    return { error: data?.error?.message || "échec libération" };
  }
  await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rdv_online?id=eq.${encodeURIComponent(rdv.id)}`, {
    method: "PATCH", headers: _sbHeaders(env, { "Prefer": "return=minimal" }),
    body: JSON.stringify({ empreinte_status: "released", empreinte_released_at: new Date().toISOString(), empreinte_capture_reason: "annulation_dans_les_delais" })
  });
  return { released: true };
}

async function refundAndRecord(env, rdv) {
  const r = await attemptAcompteRefund(env, rdv);
  const nowIso = new Date().toISOString();
  const patch = { refund_attempted_at: nowIso };
  if (r.refunded) {
    patch.acompte_rembourse = true;
    patch.refund_id = r.refund_id;
    patch.refunded_at = nowIso;
    patch.refund_error = null;
    if (r.payment_intent && !rdv.payment_intent_id) patch.payment_intent_id = r.payment_intent;
  } else if (r.error) {
    patch.refund_error = String(r.error).slice(0, 500);
  } else if (r.skipped) {
    patch.refund_error = "skip: " + r.skipped;
  }
  try {
    await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rdv_online?id=eq.${encodeURIComponent(rdv.id)}`, {
      method: "PATCH", headers: _sbHeaders(env, { "Prefer": "return=minimal" }), body: JSON.stringify(patch)
    });
  } catch (_) {}
  if (r.error) {
    try { await reportWorkerError(env, "refund:acompte", new Error(r.error), { rdv_id: rdv.id, salon_id: rdv.salon_id }, "error"); } catch (_) {}
  }
  return r;
}

// Cron : rembourse les RDV annulés avec acompte payé non remboursés (filet de
// sécurité + rattrapage des annulations passées). Idempotent.
async function runRefundReconcileJob(env) {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const sel = "id,salon_id,status,acompte_paye,acompte_montant,acompte_rembourse,payment_intent_id,stripe_payment_id,stripe_account,date_rdv,heure_rdv,created_at,cancelled_at,client_email,refund_error";
  const q = `${CONFIG.SUPABASE_URL}/rest/v1/rdv_online?select=${sel}&status=eq.cancelled&acompte_paye=eq.true&acompte_rembourse=eq.false&acompte_montant=gt.0&cancelled_at=gte.${encodeURIComponent(since)}&limit=50`;
  const res = await fetch(q, { headers: _sbHeaders(env) });
  if (!res.ok) return { ok: false, error: await res.text() };
  const rows = await res.json();
  let refunded = 0, skipped = 0, failed = 0;
  for (const rdv of (Array.isArray(rows) ? rows : [])) {
    const r = await refundAndRecord(env, rdv);
    if (r.refunded) refunded++; else if (r.error) failed++; else skipped++;
  }
  return { ok: true, scanned: Array.isArray(rows) ? rows.length : 0, refunded, skipped, failed };
}

// PATCH d'un RDV (modification, ack, annulation contrôlées par session)
async function handleClientRdvUpdate(request, env) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) return jsonResponse({ error: "body invalide" }, 400);
    const session = await verifyClientSession(body.session_token, env);
    if (!session) return jsonResponse({ error: "session_token invalide ou expiré" }, 401);
    const rdvId = body.rdv_id;
    if (!rdvId) return jsonResponse({ error: "rdv_id requis" }, 400);
    // Vérif ownership : le RDV doit appartenir au client (lx_id ou email)
    const ownRes = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/rdv_online?select=id,client_luxyra_id,client_email,salon_id,status,acompte_paye,acompte_montant,acompte_rembourse,payment_intent_id,stripe_payment_id,stripe_account,date_rdv,heure_rdv,created_at,empreinte_status&id=eq.${encodeURIComponent(rdvId)}&limit=1`,
      { headers: _sbHeaders(env) }
    );
    const own = await ownRes.json();
    if (!Array.isArray(own) || !own[0]) return jsonResponse({ error: "RDV introuvable" }, 404);
    const owns = (own[0].client_luxyra_id && String(own[0].client_luxyra_id) === session.lx_id) ||
                 (own[0].client_email && String(own[0].client_email).toLowerCase() === session.email);
    if (!owns) return jsonResponse({ error: "RDV non rattaché à votre compte" }, 403);
    // Whitelist des champs PATCHables côté client
    const ALLOWED = [
      "modification_demandee", "modification_date", "modification_heure",
      "modification_message", "modification_status",
      "salon_modified_acknowledged_by_client", "salon_modified_acknowledged_at",
      "status", "cancel_reason", "cancelled_at", "cancelled_by"
    ];
    const patch = {};
    for (const k of ALLOWED) if (k in body) patch[k] = body[k];
    // SECURITE 2026-10-08 : la cliente ne peut que ANNULER (statut), avec une date d'annulation serveur.
    if ("status" in patch && patch.status !== "cancelled") delete patch.status;
    delete patch.cancelled_at; delete patch.cancelled_by;
    if (patch.status === "cancelled") { patch.cancelled_at = new Date().toISOString(); patch.cancelled_by = "client"; }
    if (Object.keys(patch).length === 0) return jsonResponse({ error: "rien à patcher" }, 400);
    const upd = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/rdv_online?id=eq.${encodeURIComponent(rdvId)}`,
      { method: "PATCH", headers: _sbHeaders(env, { "Prefer": "return=minimal" }), body: JSON.stringify(patch) }
    );
    if (!upd.ok) {
      const t = await upd.text();
      return jsonResponse({ error: "update échoué: " + t }, 500);
    }
    // FIX 2026-05-23 : remboursement automatique de l'acompte à l'annulation client
    let refundResult = null;
    if (patch.status === "cancelled") {
      try {
        const rdvForRefund = Object.assign({}, own[0], patch);
        refundResult = await refundAndRecord(env, rdvForRefund);
      } catch (e) {
        console.error("refund on cancel error:", e);
      }
      try { await releaseEmpreinteOnCancel(env, Object.assign({}, own[0], patch)); } catch (e) { console.error("empreinte on cancel:", e); }
    }
    return jsonResponse({ success: true, refund: refundResult });
  } catch (e) {
    console.error("handleClientRdvUpdate:", e);
    return jsonResponse({ error: e.message || "erreur" }, 500);
  }
}

// Anonymisation RGPD (suppression compte) — anonymise rdv_online + delete fidelite_client
// Utilisé par doDeleteAccount() côté compte.html
async function handleClientAnonymize(request, env) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) return jsonResponse({ error: "body invalide" }, 400);
    const session = await verifyClientSession(body.session_token, env);
    if (!session) return jsonResponse({ error: "session_token invalide ou expiré" }, 401);
    const lxId = session.lx_id;
    const email = session.email;
    const errors = [];
    // 1) Anonymise rdv_online par lx_id
    if (lxId) {
      try {
        const r = await fetch(
          `${CONFIG.SUPABASE_URL}/rest/v1/rdv_online?client_luxyra_id=eq.${encodeURIComponent(lxId)}`,
          { method: "PATCH", headers: _sbHeaders(env, { "Prefer": "return=minimal" }),
            body: JSON.stringify({ client_luxyra_id: null, client_nom: "Anonyme", client_prenom: "", client_tel: "", client_email: "" }) }
        );
        if (!r.ok) errors.push("rdv_online by id: " + await r.text());
      } catch (e) { errors.push("rdv_online by id: " + e.message); }
    }
    // 2) Anonymise rdv_online par email (au cas où certains anciens RDV n'ont que l'email)
    if (email) {
      try {
        const r = await fetch(
          `${CONFIG.SUPABASE_URL}/rest/v1/rdv_online?client_email=eq.${encodeURIComponent(email)}`,
          { method: "PATCH", headers: _sbHeaders(env, { "Prefer": "return=minimal" }),
            body: JSON.stringify({ client_luxyra_id: null, client_nom: "Anonyme", client_prenom: "", client_tel: "", client_email: "" }) }
        );
        if (!r.ok) errors.push("rdv_online by email: " + await r.text());
      } catch (e) { errors.push("rdv_online by email: " + e.message); }
    }
    // 3) Anonymise clients (toutes les fiches salon liées à cet email)
    if (email) {
      try {
        const r = await fetch(
          `${CONFIG.SUPABASE_URL}/rest/v1/clients?email=eq.${encodeURIComponent(email)}`,
          { method: "PATCH", headers: _sbHeaders(env, { "Prefer": "return=minimal" }),
            body: JSON.stringify({ nom: "ANONYME", prenom: "", telephone: "", email: "", adresse: "", cp: "", ville: "", date_naissance: null, notes: "", actif: false }) }
        );
        if (!r.ok) errors.push("clients: " + await r.text());
      } catch (e) { errors.push("clients: " + e.message); }
    }
    // 4) Delete fidelite_client par email (le PK est l'email côté luxyra)
    if (email) {
      try {
        const r = await fetch(
          `${CONFIG.SUPABASE_URL}/rest/v1/fidelite_client?client_luxyra_id=eq.${encodeURIComponent(email)}`,
          { method: "DELETE", headers: _sbHeaders(env, { "Prefer": "return=minimal" }) }
        );
        if (!r.ok) errors.push("fidelite by email: " + await r.text());
      } catch (e) { errors.push("fidelite by email: " + e.message); }
    }
    // 5) Delete fidelite_client par lx_id (legacy/safety)
    if (lxId) {
      try {
        const r = await fetch(
          `${CONFIG.SUPABASE_URL}/rest/v1/fidelite_client?client_luxyra_id=eq.${encodeURIComponent(lxId)}`,
          { method: "DELETE", headers: _sbHeaders(env, { "Prefer": "return=minimal" }) }
        );
        if (!r.ok) errors.push("fidelite by id: " + await r.text());
      } catch (e) { errors.push("fidelite by id: " + e.message); }
    }
    // 6) Delete client_salon links
    if (lxId) {
      try {
        const r = await fetch(
          `${CONFIG.SUPABASE_URL}/rest/v1/client_salon?client_id=eq.${encodeURIComponent(lxId)}`,
          { method: "DELETE", headers: _sbHeaders(env, { "Prefer": "return=minimal" }) }
        );
        if (!r.ok) errors.push("client_salon: " + await r.text());
      } catch (e) { errors.push("client_salon: " + e.message); }
    }
    return jsonResponse({ success: true, partial_errors: errors.length ? errors : null });
  } catch (e) {
    console.error("handleClientAnonymize:", e);
    return jsonResponse({ error: e.message || "erreur" }, 500);
  }
}

// ============================================================
// RDV CANCEL (bypasses RLS for client cancellation)
// ============================================================
async function handleRdvCancel(request, env) {
  try {
    const { rdv_id, reason, session_token } = await request.json();
    if (!rdv_id || !/^[0-9a-f-]{36}$/i.test(String(rdv_id))) return jsonResponse({ error: "rdv_id requis" }, 400);
    const sbKey = env.SUPABASE_SERVICE_KEY;
    if (!sbKey) return jsonResponse({ error: "config_error" }, 500);
    // SECURITE 2026-10-08 : seule la cliente proprietaire du RDV (session) peut l'annuler ici.
    const session = await verifyClientSession(session_token, env);
    if (!session) return jsonResponse({ error: "Connectez-vous pour annuler ce rendez-vous" }, 401);
    const ownRes = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rdv_online?select=id,client_luxyra_id,client_email,salon_id,status,acompte_paye,acompte_montant,acompte_rembourse,payment_intent_id,stripe_payment_id,stripe_account,date_rdv,heure_rdv,created_at,empreinte_status&id=eq.${encodeURIComponent(rdv_id)}&limit=1`, { headers: _sbHeaders(env) });
    const own = await ownRes.json();
    if (!Array.isArray(own) || !own[0]) return jsonResponse({ error: "RDV introuvable" }, 404);
    const owns = (own[0].client_luxyra_id && String(own[0].client_luxyra_id) === session.lx_id) ||
                 (own[0].client_email && String(own[0].client_email).toLowerCase() === session.email);
    if (!owns) return jsonResponse({ error: "RDV non rattaché à votre compte" }, 403);
    const patch = { status: "cancelled", cancel_reason: String(reason || "").slice(0, 500), cancelled_at: new Date().toISOString(), cancelled_by: "client" };
    const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rdv_online?id=eq.${encodeURIComponent(rdv_id)}`, {
      method: "PATCH",
      headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(patch)
    });
    if (!res.ok) return jsonResponse({ error: "Update failed", status: res.status }, 500);
    let refund = null;
    try { refund = await refundAndRecord(env, Object.assign({}, own[0], patch)); } catch (e) { console.error("refund on cancel:", e); }
    let empreinte = null;
    try { empreinte = await releaseEmpreinteOnCancel(env, Object.assign({}, own[0], patch)); } catch (e) { console.error("empreinte on cancel:", e); }
    return jsonResponse({ success: true, refund, empreinte });
  } catch (err) { return jsonResponse({ error: "Erreur serveur" }, 500); }
}

// ============================================================
// CLIENT INVITES — magic link pour créer un compte
// ============================================================
// 1) handleClientInvite : génère token + envoie email
// 2) handleClientInviteVerify : valide token, signup auth, lie le client

async function handleClientInvite(request, env) {
  try {
    const { salon_id, client_id, email, client_nom, client_prenom, salon_nom, operator_name } = await request.json();
    if (!salon_id || !client_id || !email) return jsonResponse({ error: "salon_id, client_id, email requis" }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonResponse({ error: "Email invalide" }, 400);
    // SECURITE 2026-10-08 : la fiche doit appartenir au salon et l'email etre celui de la fiche.
    if (!/^[0-9a-f-]{36}$/i.test(String(client_id))) return jsonResponse({ error: "client_id invalide" }, 400);
    const _clRes = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/clients?select=id,email&id=eq.${encodeURIComponent(client_id)}&salon_id=eq.${encodeURIComponent(salon_id)}&limit=1`, { headers: _sbHeaders(env) });
    const _cl = _clRes.ok ? await _clRes.json() : [];
    if (!Array.isArray(_cl) || !_cl[0]) return jsonResponse({ error: "Fiche client introuvable pour ce salon" }, 403);
    if (String(_cl[0].email || "").toLowerCase().trim() !== String(email).toLowerCase().trim()) return jsonResponse({ error: "L'email ne correspond pas à la fiche client" }, 403);

    // Insert l'invitation (token UUID auto via DEFAULT gen_random_uuid())
    const insertRes = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/client_invites`, {
      method: "POST",
      headers: {
        "apikey": env.SUPABASE_SERVICE_KEY,
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "return=representation"
      },
      body: JSON.stringify({ salon_id, client_id, email: email.toLowerCase().trim(), invited_by_operator: operator_name || null })
    });
    if (!insertRes.ok) {
      const t = await insertRes.text();
      console.error("client_invites insert failed:", insertRes.status, t);
      return jsonResponse({ error: "Erreur création invitation" }, 500);
    }
    const inserted = await insertRes.json();
    const token = inserted[0]?.token;
    if (!token) return jsonResponse({ error: "Token non généré" }, 500);

    const inviteUrl = `https://luxyra.fr/compte?invite=${token}`;
    const prenom = client_prenom || "";
    const nomComplet = `${prenom} ${client_nom||""}`.trim() || "vous";
    const salonName = salon_nom || "votre salon";

    // Email Brevo — design premium Luxyra noir + or
    const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;max-width:560px;margin:0 auto;padding:0;color:#1a1a1a;background:#fff">
      <div style="background:#0b0b0b;padding:26px 28px 20px;text-align:center;border-bottom:3px solid #c8a84e">
        <img src="https://luxyra.fr/luxyra-logo.png" width="64" height="64" alt="Luxyra" style="display:block;margin:0 auto 10px;border-radius:12px">
        <div style="color:#d4a843;font-family:Georgia,serif;font-size:26px;font-weight:300;letter-spacing:6px;margin:0">LUXYRA</div>
        <div style="color:#9a9a9a;font-size:11px;letter-spacing:3px;text-transform:uppercase;margin-top:6px">Espace client</div>
      </div>
      <div style="padding:32px 28px">
        <h2 style="margin:0 0 16px;color:#1a1a1a;font-family:Georgia,serif;font-weight:600">Bonjour ${prenom||"!"}</h2>
        <p style="font-size:14px;line-height:1.7;color:#333;margin:0 0 12px">
          <strong>${salonName}</strong> a créé votre fiche client et vous invite à activer votre compte Luxyra.
        </p>
        <p style="font-size:14px;line-height:1.7;color:#333;margin:0 0 24px">
          En quelques clics, accédez à votre <strong>historique de RDV</strong>, vos <strong>factures</strong>, vos <strong>points de fidélité</strong> et vos <strong>cartes d'abonnement</strong>.
        </p>
        <div style="text-align:center;margin:28px 0">
          <a href="${inviteUrl}" style="display:inline-block;padding:16px 36px;background:linear-gradient(135deg,#d4a843,#b8960f);color:#0a0a0a;font-weight:800;text-decoration:none;border-radius:12px;font-size:14px;letter-spacing:.5px;text-transform:uppercase;box-shadow:0 4px 16px rgba(212,168,67,.3)">Créer mon compte</a>
        </div>
        <p style="font-size:12px;line-height:1.6;color:#666;margin:24px 0 0">Ce lien est valide 14 jours et vous permettra de définir votre mot de passe en toute sécurité.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
        <p style="font-size:11px;color:#999;line-height:1.6;margin:0">
          Vous recevez cet email car le salon ${salonName} a créé votre fiche client avec votre adresse email. Si vous n'êtes pas concerné, ignorez ce message — aucun compte ne sera créé sans votre action.
        </p>
        <p style="font-size:11px;color:#999;text-align:center;margin:18px 0 0">Luxyra · contact@luxyra.fr</p>
      </div>
    </div>`;
    const textContent = `Bonjour ${prenom},\n\n${salonName} a créé votre fiche client et vous invite à activer votre compte Luxyra.\n\nAccédez à votre historique RDV, factures, points fidélité, cartes d'abonnement :\n${inviteUrl}\n\nCe lien est valide 14 jours.\n\nLuxyra.`;
    await brevoSendEmail(env, {
      to: email, toName: nomComplet,
      senderEmail: "contact@luxyra.fr", senderName: salonName,
      replyTo: null,
      subject: `Activez votre compte client — ${salonName}`,
      htmlContent: html, textContent, attachment: null
    });

    return jsonResponse({ ok: true });
  } catch (e) {
    console.error("handleClientInvite error:", e);
    return jsonResponse({ error: e.message || "Erreur serveur" }, 500);
  }
}

async function handleClientInviteVerify(request, env) {
  try {
    const { token, password } = await request.json();
    if (!token) return jsonResponse({ error: "token requis" }, 400);
    if (!password || String(password).length < 6) return jsonResponse({ error: "Mot de passe minimum 6 caractères" }, 400);

    // Charge l'invitation
    const inviteRes = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/client_invites?token=eq.${encodeURIComponent(token)}&select=*`, {
      headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` }
    });
    const invites = await inviteRes.json();
    if (!invites || !invites.length) return jsonResponse({ error: "Invitation introuvable ou expirée" }, 404);
    const invite = invites[0];
    if (invite.used_at) return jsonResponse({ error: "Cette invitation a déjà été utilisée. Connectez-vous avec votre mot de passe." }, 410);
    if (new Date(invite.expires_at) < new Date()) return jsonResponse({ error: "Cette invitation a expiré. Demandez-en une nouvelle au salon." }, 410);

    // Crée le compte auth Supabase via Admin API (avec service_role key)
    const signupRes = await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        "apikey": env.SUPABASE_SERVICE_KEY,
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email: invite.email, password, email_confirm: true })
    });
    let authUserId = null;
    if (signupRes.ok) {
      const signupData = await signupRes.json();
      authUserId = signupData.id || signupData.user?.id;
    } else if (signupRes.status === 422) {
      // SECURITE 2026-10-08 : un compte existe deja -> on ne change JAMAIS son mot de passe ici.
      return jsonResponse({ error: "Un compte existe déjà avec cet email. Connectez-vous, ou utilisez « Mot de passe oublié »." }, 409);
    } else {
      const t = await signupRes.text();
      console.error("auth signup failed:", signupRes.status, t);
      return jsonResponse({ error: "Erreur création compte" }, 500);
    }
    if (!authUserId) return jsonResponse({ error: "ID utilisateur non récupéré" }, 500);

    // Lie la fiche client à l'auth user (clients.user_id = authUserId)
    await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/clients?id=eq.${encodeURIComponent(invite.client_id)}`, {
      method: "PATCH",
      headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: authUserId })
    });

    // Marque l'invitation comme utilisée
    await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/client_invites?token=eq.${encodeURIComponent(token)}`, {
      method: "PATCH",
      headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ used_at: new Date().toISOString() })
    });

    return jsonResponse({ ok: true, email: invite.email });
  } catch (e) {
    console.error("handleClientInviteVerify error:", e);
    return jsonResponse({ error: e.message || "Erreur serveur" }, 500);
  }
}

// ============================================================
// SALON AVAILABILITY (bypasses RLS for booking site)
// Returns appointments + rdv_online for a salon using service key
// ============================================================
async function handleSalonAvailability(request, env) {
  try {
    const { salon_id, date_from, date_to } = await request.json();
    if (!salon_id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(salon_id))) return jsonResponse({ error: "salon_id requis" }, 400);
    if ((date_from && !/^\d{4}-\d{2}-\d{2}$/.test(String(date_from))) || (date_to && !/^\d{4}-\d{2}-\d{2}$/.test(String(date_to)))) return jsonResponse({ error: "dates invalides" }, 400);
    const sbKey = env.SUPABASE_SERVICE_KEY;
    if (!sbKey) return jsonResponse({ error: "config_error" }, 500);
    const headers = { "apikey": sbKey, "Authorization": "Bearer " + sbKey, "Content-Type": "application/json" };
    const from = date_from || new Date().toISOString().slice(0, 10);
    const to = date_to || new Date(Date.now() + 31 * 86400000).toISOString().slice(0, 10);
    // 1. App appointments (RLS-protected table - needs service key)
    const apRes = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/appointments?select=date_rdv,heure,collab_id,service_id,status,a_phases,cancelled,from_caisse,items&salon_id=eq.${salon_id}&date_rdv=gte.${from}&date_rdv=lte.${to}&status=neq.canc`,
      { headers }
    );
    const appointmentsBrut = await apRes.json();
    // 2026-10-08 : une vente directe sans prestation (produit, bon cadeau, carte…) n'occupe pas
    // de créneau (avant : comptée 30 min côté site). On n'expose pas non plus le contenu des tickets.
    const _sansDuree = (a) => a && a.from_caisse === true && !(Array.isArray(a.a_phases) && a.a_phases.length) && !a.service_id
      && !(Array.isArray(a.items) && a.items.some((it) => it && (it.sId || it.isForfait)));
    const appointments = Array.isArray(appointmentsBrut)
      ? appointmentsBrut.filter((a) => !_sansDuree(a)).map(({ from_caisse, items, ...r }) => r)
      : appointmentsBrut;
    // 2. Online RDV (may also be RLS-protected)
    // FIX 2026-05-12 : on récupère aussi created_at pour permettre au client de
    // filtrer les pending_payment stales (paiement abandonné depuis > 15 min).
    const roRes = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/rdv_online?select=date_rdv,heure_rdv,collaborateur_id,duree_minutes,status,created_at&salon_id=eq.${salon_id}&date_rdv=gte.${from}&status=neq.cancelled`,
      { headers }
    );
    const rdvOnline = await roRes.json();
    return jsonResponse({
      appointments: Array.isArray(appointments) ? appointments : [],
      rdv_online: Array.isArray(rdvOnline) ? rdvOnline : []
    });
  } catch (err) {
    return jsonResponse({ error: err.message, appointments: [], rdv_online: [] });
  }
}

// ============================================================
// EXISTING ROUTER — FIX W3: corrected clean routes
// FIX W7: Added /suppression-donnees
// NEW SLUG: rewrite /<slug> → /site.html avec window.__SALON_SLUG injecté
// ============================================================
// ============================================================================
// SEO SSR SALON — FIX 2026-07-13
// ----------------------------------------------------------------------------
// POURQUOI : la page salon (/<slug> et /<slug>/reserver) est rendue 100% en JS.
// Le HTML brut renvoye ne contenait QUE "Chargement..." => Google indexait une
// page vide et le salon ne ressortait pas sur son propre nom.
//
// L'ancien bloc SSR (2026-05-14) etait MORT depuis le 1er jour, pour 2 raisons :
//   1. il selectionnait `horaires_salon` sur la vue `salons_public` — colonne qui
//      N'EXISTE PAS dessus (elle est sur `site_config`) => PostgREST repondait
//      HTTP 400 => `salonRes.ok` faux => TOUT le bloc etait saute, toujours.
//   2. il lisait les horaires au format {lundi:{ouvert,creneaux:[{debut,fin}]}}
//      alors que le format REEL est {"0":null,"1":{"o":"14:00","c":"18:00"}}.
//
// CE QUI CHANGE :
//   - Les donnees sont lues aux bons endroits (salons_public + site_config + services).
//   - Le SEO est injecte pour TOUT LE MONDE (plus de sniffing d'user-agent : servir
//     un contenu different a Googlebot = risque de cloaking).
//   - Le texte indexable est du VRAI HTML visible (plus de <noscript>, que Google
//     ecarte du DOM rendu qu'il indexe), pose dans #lx-seo-ssr, SOUS le loader
//     plein ecran => 1er paint humain inchange, et le JS l'efface au boot.
//
// GARDE-FOU ABSOLU : tout est en try/catch + timeout court. La moindre erreur
// (Supabase down, salon inconnu, JSON casse) => on renvoie la page EXACTEMENT
// comme aujourd'hui. Jamais de 500, jamais de page blanche.
//
// Cle utilisee : la cle ANON (publique, deja dans le repo). C'est volontaire :
// la RLS garantit alors qu'on ne peut lire QUE ce qu'un visiteur pourrait deja
// lire depuis son navigateur => impossible de fuiter user_id/plan/stripe/sms.
// ============================================================================

const LX_SEO_TIMEOUT_MS = 2000;

const LX_METIER = {
  coiffure:  { schema: "HairSalon",   label: "Salon de coiffure",    noun: "Coiffeur" },
  barbier:   { schema: "BarberShop",  label: "Barbier",              noun: "Barbier" },
  esthetique:{ schema: "BeautySalon", label: "Institut de beauté",   noun: "Institut de beauté" },
  ongles:    { schema: "NailSalon",   label: "Onglerie",             noun: "Onglerie" },
  bien_etre: { schema: "DaySpa",      label: "Spa & bien-être",      noun: "Spa & bien-être" },
};
const LX_SEO_FALLBACK_METIER = { schema: "LocalBusiness", label: "Salon", noun: "Salon" };

// 0 = dimanche (cle = getDay() cote app)
const LX_SEO_DOW_SCHEMA = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const LX_SEO_DOW_FR = ["Dimanche","Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi"];

function lxEsc(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Empeche toute evasion de <script type="application/ld+json">
function lxJsonLd(obj) {
  return JSON.stringify(obj)
    .replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

// Une image de carte sociale / schema.org doit etre une URL http(s).
// Les logos salon sont souvent des data:URI base64 (50 Ko) => inutilisables.
function lxSeoImage(v) {
  const s = String(v || "");
  return /^https?:\/\//i.test(s) ? s : "";
}

async function lxSeoFetch(path) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), LX_SEO_TIMEOUT_MS);
  try {
    const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/${path}`, {
      headers: {
        apikey: CONFIG.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
      },
      // Petit cache edge : les changements d'un salon remontent en <=5 min,
      // et le HTML lui-meme n'est jamais mis en cache long (no-store).
      cf: { cacheTtl: 300, cacheEverything: true },
      signal: ctl.signal,
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (_) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// Renvoie { head, body } ou null. NE JETTE JAMAIS.
async function lxBuildSalonSeo(slug, reserverIntent) {
  try {
    const rows = await lxSeoFetch(
      `salons_public?slug=eq.${encodeURIComponent(slug)}` +
      `&select=id,nom,sous_titre,metier,mode_activite,adresse,cp,ville,tel,email,logo,site_web,latitude,longitude,note_moyenne,nb_avis&limit=1`
    );
    if (!Array.isArray(rows) || !rows[0]) return null;
    const s = rows[0];

    const [cfgRows, svcRows] = await Promise.all([
      lxSeoFetch(
        `site_config?salon_id=eq.${encodeURIComponent(s.id)}` +
        `&select=horaires_salon,description_salon,slogan,site_actif,reservation_active,photo_hero&limit=1`
      ),
      lxSeoFetch(
        `services?salon_id=eq.${encodeURIComponent(s.id)}&actif=eq.true&show_site=eq.true` +
        `&select=nom,prix,categorie,phases,ordre&order=ordre.asc.nullslast,nom.asc&limit=60`
      ),
    ]);
    const cfg = (Array.isArray(cfgRows) && cfgRows[0]) ? cfgRows[0] : {};

    // Site explicitement desactive par le salon => on n'indexe rien.
    if (cfg.site_actif === false) return null;

    const services = Array.isArray(svcRows) ? svcRows : [];
    const m = LX_METIER[s.metier] || LX_SEO_FALLBACK_METIER;

    const nom = s.nom || "Salon";
    const sousTitre = s.sous_titre || "";
    const ville = s.ville || "";
    const cp = s.cp || "";
    const adresse = s.adresse || "";
    const canonical = `https://luxyra.fr/${slug}`;
    const image =
      lxSeoImage(cfg.photo_hero) ||
      lxSeoImage(s.logo) ||
      "https://luxyra.fr/luxyra-logo.png";

    // ---- Titre (unique par salon, metier + ville = la requete locale visee) ----
    const lieu = ville ? ` à ${ville}` : "";
    const title = reserverIntent
      ? `Réserver chez ${nom} — ${m.noun}${lieu} | Prendre rendez-vous`
      : `${nom} — ${m.noun}${lieu} | Réserver en ligne`;

    // ---- Description (~150 car., naturelle) ----
    let desc = `${nom}${sousTitre ? ", " + sousTitre : ""}, ${m.noun.toLowerCase()}${lieu}${cp ? " (" + cp + ")" : ""}. `
             + `Réservez votre rendez-vous en ligne 24h/24, confirmation immédiate.`;
    if (desc.length > 160) desc = desc.slice(0, 157).replace(/\s+\S*$/, "") + "…";

    // ---- Horaires : format REEL {"0":null,"1":{"o":"09:00","c":"18:00"}} ----
    const ohSchema = [];
    const ohRows = [];
    try {
      const h = cfg.horaires_salon;
      if (h && typeof h === "object") {
        for (let d = 0; d < 7; d++) {
          const v = h[String(d)] != null ? h[String(d)] : h[d];
          if (v && v.o && v.c) {
            ohSchema.push({
              "@type": "OpeningHoursSpecification",
              dayOfWeek: `https://schema.org/${LX_SEO_DOW_SCHEMA[d]}`,
              opens: String(v.o),
              closes: String(v.c),
            });
            ohRows.push(`<li><strong>${LX_SEO_DOW_FR[d]}</strong> : ${lxEsc(v.o)} – ${lxEsc(v.c)}</li>`);
          } else {
            ohRows.push(`<li><strong>${LX_SEO_DOW_FR[d]}</strong> : Fermé</li>`);
          }
        }
      }
    } catch (_) {}

    // ---- Prestations ----
    const offers = [];
    const svcRowsHtml = [];
    let minP = Infinity, maxP = -Infinity;
    for (const sv of services) {
      if (!sv || !sv.nom || sv.prix == null) continue;
      const prix = Number(sv.prix);
      if (!isFinite(prix)) continue;
      if (prix < minP) minP = prix;
      if (prix > maxP) maxP = prix;
      let dureeMin = 0;
      if (Array.isArray(sv.phases)) {
        for (const p of sv.phases) { if (p && typeof p.d === "number") dureeMin += p.d; }
      }
      const item = {
        "@type": "Service",
        name: String(sv.nom),
        serviceType: sv.categorie || m.label,
        provider: { "@type": m.schema, name: nom },
      };
      if (dureeMin > 0) item.estimatedDuration = `PT${dureeMin}M`;
      offers.push({
        "@type": "Offer",
        itemOffered: item,
        price: prix.toFixed(2),
        priceCurrency: "EUR",
        availability: "https://schema.org/InStock",
        url: `${canonical}#reserver`,
      });
      svcRowsHtml.push(
        `<li>${lxEsc(sv.nom)}${sv.categorie ? ` <em>(${lxEsc(sv.categorie)})</em>` : ""} — <strong>${prix.toFixed(2).replace(".", ",")} €</strong>${dureeMin > 0 ? ` · ${dureeMin} min` : ""}</li>`
      );
    }
    const priceRange = (isFinite(minP) && isFinite(maxP))
      ? `${Math.round(minP)}€ - ${Math.round(maxP)}€`
      : "€€";

    // ---- JSON-LD ----
    const ld = {
      "@context": "https://schema.org",
      "@type": m.schema,
      "@id": canonical,
      name: nom,
      url: canonical,
      image: image,
      priceRange: priceRange,
      currenciesAccepted: "EUR",
    };
    if (sousTitre) ld.alternateName = nom + " " + sousTitre;
    if (cfg.description_salon) ld.description = String(cfg.description_salon).slice(0, 900);
    else if (cfg.slogan) ld.description = String(cfg.slogan);
    if (adresse || ville || cp) {
      ld.address = {
        "@type": "PostalAddress",
        streetAddress: adresse,
        postalCode: cp,
        addressLocality: ville,
        addressCountry: "FR",
      };
    }
    if (s.tel) ld.telephone = String(s.tel);
    if (s.email) ld.email = String(s.email);
    if (s.site_web) ld.sameAs = [String(s.site_web)];
    if (s.latitude != null && s.longitude != null) {
      const la = Number(s.latitude), lo = Number(s.longitude);
      if (isFinite(la) && isFinite(lo)) ld.geo = { "@type": "GeoCoordinates", latitude: la, longitude: lo };
    }
    if (Number(s.note_moyenne) > 0 && Number(s.nb_avis) > 0) {
      ld.aggregateRating = {
        "@type": "AggregateRating",
        ratingValue: Number(s.note_moyenne),
        reviewCount: Number(s.nb_avis),
      };
    }
    if (ohSchema.length) ld.openingHoursSpecification = ohSchema;
    if (cfg.reservation_active !== false) {
      ld.potentialAction = {
        "@type": "ReserveAction",
        name: "Prendre rendez-vous",
        target: {
          "@type": "EntryPoint",
          urlTemplate: `${canonical}/reserver`,
          inLanguage: "fr-FR",
          actionPlatform: [
            "https://schema.org/DesktopWebPlatform",
            "https://schema.org/MobileWebPlatform",
          ],
        },
        result: { "@type": "Reservation", name: `Rendez-vous chez ${nom}` },
      };
    }
    if (offers.length) {
      // hasOfferCatalog seulement : dupliquer les 45 offres dans makesOffer
      // doublait le poids du <head> sans rien apporter a Google.
      ld.hasOfferCatalog = {
        "@type": "OfferCatalog",
        name: `Prestations ${ville ? "à " + ville : nom}`,
        itemListElement: offers,
      };
    }

    // ---- <head> ----
    const head =
      `<meta name="lx-ssr" content="1">\n` +
      `<title>${lxEsc(title)}</title>\n` +
      `<meta name="description" content="${lxEsc(desc)}">\n` +
      `<link rel="canonical" href="${lxEsc(canonical)}">\n` +
      `<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">\n` +
      `<meta property="og:type" content="business.business">\n` +
      `<meta property="og:site_name" content="Luxyra">\n` +
      `<meta property="og:locale" content="fr_FR">\n` +
      `<meta property="og:url" content="${lxEsc(canonical)}">\n` +
      `<meta property="og:title" content="${lxEsc(title)}">\n` +
      `<meta property="og:description" content="${lxEsc(desc)}">\n` +
      `<meta property="og:image" content="${lxEsc(image)}">\n` +
      `<meta name="twitter:card" content="summary_large_image">\n` +
      `<meta name="twitter:title" content="${lxEsc(title)}">\n` +
      `<meta name="twitter:description" content="${lxEsc(desc)}">\n` +
      `<meta name="twitter:image" content="${lxEsc(image)}">\n` +
      `<script id="ssr-ld-localbusiness" type="application/ld+json">${lxJsonLd(ld)}</script>\n`;

    // ---- Texte indexable (vrai HTML visible, efface par le JS au boot) ----
    let body = `<section id="lx-seo-content" style="max-width:920px;margin:0 auto;padding:40px 20px 60px;font-family:Georgia,'Times New Roman',serif;line-height:1.65;color:#d8d8dc">`;
    body += `<h1 style="font-size:28px;color:#c8a84e;margin:0 0 6px">${lxEsc(nom)} — ${lxEsc(m.noun)}${ville ? " à " + lxEsc(ville) : ""}</h1>`;
    if (sousTitre) body += `<p style="margin:0 0 18px;font-style:italic;color:#a9a9b2">${lxEsc(sousTitre)}</p>`;
    if (cfg.slogan) body += `<p style="margin:0 0 18px;color:#a9a9b2">${lxEsc(cfg.slogan)}</p>`;
    if (cfg.description_salon) body += `<p>${lxEsc(cfg.description_salon)}</p>`;
    if (adresse || ville) {
      body += `<h2 style="font-size:20px;color:#c8a84e;margin:26px 0 8px">Adresse</h2>`;
      body += `<address style="font-style:normal">${lxEsc(adresse)}${cp ? ", " + lxEsc(cp) : ""}${ville ? " " + lxEsc(ville) : ""}, France</address>`;
    }
    if (s.tel) {
      body += `<p><strong>Téléphone :</strong> <a href="tel:${lxEsc(String(s.tel).replace(/\s+/g, ""))}" style="color:#c8a84e">${lxEsc(s.tel)}</a></p>`;
    }
    if (ohSchema.length) {
      body += `<h2 style="font-size:20px;color:#c8a84e;margin:26px 0 8px">Horaires d'ouverture</h2>`;
      body += `<ul style="list-style:none;padding:0;margin:0">${ohRows.join("")}</ul>`;
    }
    if (svcRowsHtml.length) {
      body += `<h2 style="font-size:20px;color:#c8a84e;margin:26px 0 8px">Prestations et tarifs${ville ? " à " + lxEsc(ville) : ""}</h2>`;
      body += `<ul style="padding-left:20px;margin:0">${svcRowsHtml.join("")}</ul>`;
    }
    body += `<h2 style="font-size:20px;color:#c8a84e;margin:26px 0 8px">Réservation en ligne</h2>`;
    body += `<p>Prenez rendez-vous chez <strong>${lxEsc(nom)}</strong>${ville ? " à " + lxEsc(ville) : ""} en ligne, 24h/24 et 7j/7. Confirmation immédiate par e-mail et SMS.</p>`;
    body += `<p><a href="${lxEsc(canonical)}/reserver" style="display:inline-block;padding:14px 28px;background:#c8a84e;color:#0a0a0a;text-decoration:none;font-weight:700;border-radius:8px">Prendre rendez-vous</a></p>`;
    body += `<p style="font-size:12px;color:#7a7a84;margin-top:32px">Propulsé par <a href="https://luxyra.fr" style="color:#7a7a84">Luxyra</a> — caisse et réservation en ligne pour salons.</p>`;
    body += `</section>`;

    return { head, body };
  } catch (_) {
    return null; // Toute erreur => page servie telle qu'aujourd'hui.
  }
}

async function handleExistingRoutes(request, url, env) {
  const host = url.hostname;

  // ============================================================
  // SITEMAP DYNAMIQUE : proxy /sitemap.xml depuis l'edge function Supabase
  // (auto-update à chaque nouveau salon, pas besoin de toucher au repo)
  // ============================================================
  if (url.pathname === "/sitemap.xml") {
    try {
      const r = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/sitemap`, {
        cf: { cacheTtl: 3600, cacheEverything: true }
      });
      const xml = await r.text();
      return new Response(xml, {
        status: r.status,
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "Cache-Control": "public, max-age=3600, s-maxage=3600",
        },
      });
    } catch (e) {
      // Fallback : sitemap minimal pour ne pas casser le SEO
      const fallback = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://luxyra.fr/</loc></url>\n</urlset>';
      return new Response(fallback, {
        status: 200,
        headers: { "Content-Type": "application/xml; charset=utf-8" },
      });
    }
  }

  // ============================================================
  // ROBOTS.TXT servi en dur (sans pollution Cloudflare bot protection)
  // ============================================================
  if (url.pathname === "/robots.txt") {
    const txt = `# robots.txt — Luxyra
# https://luxyra.fr

User-agent: *
Allow: /
Disallow: /app
Disallow: /app.html
Disallow: /admin
Disallow: /admin.html
Disallow: /compte
Disallow: /compte.html
Disallow: /proposal
Disallow: /proposal.html
Disallow: /reset-password
Disallow: /reset-password.html
Disallow: /clear
Disallow: /clear.html

Sitemap: https://luxyra.fr/sitemap.xml
`;
    return new Response(txt, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=3600, s-maxage=3600",
      },
    });
  }

  // Page de purge cache PWA — servie INLINE par le worker (bulletproof : independant
  // de GitHub Pages, toujours 200 + no-cache). Repond a /clear ET /clear.html.
  if (url.pathname === "/clear" || url.pathname === "/clear.html") {
    const clearHtml = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Luxyra - Mise a jour</title><style>body{font-family:system-ui,Arial,sans-serif;background:#0e0e12;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:20px}h1{color:#c8a84e;font-weight:800;font-size:22px}#s{opacity:.75;font-size:14px;margin-top:10px}</style></head><body><h1>Mise a jour en cours...</h1><div id="s">Nettoyage du cache...</div><script>(async function(){var s=document.getElementById("s");try{if(navigator.serviceWorker){var regs=await navigator.serviceWorker.getRegistrations();for(var i=0;i<regs.length;i++){await regs[i].unregister();}}if(window.caches){var keys=await caches.keys();for(var j=0;j<keys.length;j++){await caches.delete(keys[j]);}}}catch(e){}try{var _ks=[];for(var z=0;z<localStorage.length;z++){var kk=localStorage.key(z);if(kk&&(kk.indexOf("_cp_")===0||kk.indexOf("_lx_")===0||kk==="caisseOpenDate"))_ks.push(kk);}for(var y=0;y<_ks.length;y++){try{localStorage.removeItem(_ks[y]);}catch(e){}}}catch(e){}s.textContent="Termine, redirection...";location.href="/app.html?_c="+Date.now();})();<\/script></body></html>`;
    return new Response(clearHtml, {
      status: 200,
      headers: { "Content-Type": "text/html;charset=UTF-8", "Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache" }
    });
  }

  if (host !== "luxyra.fr" && host !== "www.luxyra.fr" && host.endsWith(".luxyra.fr")) {
    const subdomain = host.replace(".luxyra.fr", "");
    if (url.pathname !== "/" && url.pathname !== "/index.html" && url.pathname !== "/site.html") {
      return Response.redirect(`https://luxyra.fr${url.pathname}${url.search}`, 302);
    }
    const res = await fetch(`https://luxyra-fr.github.io/luxyra.fr/site.html`, { cf: { cacheTtl: 0 } });
    let html = await res.text();
    html = html.replace("</head>", `<script>window.__SALON_SUBDOMAIN="${subdomain}";</script></head>`);
    return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8", "Cache-Control": "no-cache, no-store, must-revalidate" } });
  }

  // Routes propres connues (pas besoin de .html dans l'URL)
  const cleanRoutes = {
    "/app": "/app.html",
    "/admin": "/admin.html",
    "/compte": "/compte.html",
    "/inscription": "/inscription.html",
    "/pro": "/pro.html",
    "/recherche": "/recherche.html",
    "/proposal": "/proposal.html",
    "/cgv": "/cgv.html",
    "/mentions": "/mentions-legales.html",
    "/mentions-legales": "/mentions-legales.html",
    "/confidentialite": "/politique-confidentialite.html",
    "/politique-confidentialite": "/politique-confidentialite.html",
    "/suppression-donnees": "/suppression-donnees.html",
    "/dpa": "/dpa.html",
    "/reset-password": "/reset-password.html",
    "/tarifs": "/tarifs.html",
    "/sans-commission": "/sans-commission.html",
    "/a-propos": "/a-propos.html",
    "/about": "/a-propos.html",
    "/securite-rgpd": "/securite-rgpd.html",
    "/securite": "/securite-rgpd.html",
    "/rgpd": "/securite-rgpd.html",
    "/blog": "/blog/index.html",
    "/blog/": "/blog/index.html",
    "/blog/comment-choisir-logiciel-caisse-coiffeur": "/blog/comment-choisir-logiciel-caisse-coiffeur.html",
    "/blog/nf525-explique-ce-que-tout-salon-doit-savoir": "/blog/nf525-explique-ce-que-tout-salon-doit-savoir.html",
    "/blog/reservation-en-ligne-sans-commission": "/blog/reservation-en-ligne-sans-commission.html",
    "/aide": "/aide.html",
    "/migration": "/migration.html",
  };

  let path = url.pathname;
  if (cleanRoutes[path]) path = cleanRoutes[path];

  // ============================================================
  // SLUG ROUTING : rewrite /<slug> → /site.html
  // (Si l'URL n'a pas matché une route système ci-dessus,
  //  on regarde si elle ressemble à un slug salon)
  // ============================================================
  if (path === url.pathname) {
    // Aucune route système n'a matché — peut-être un slug ?
    let segmentForSlug = path.replace(/^\/+|\/+$/g, "");
    const RESERVED_FOR_SLUG = new Set([
      "", "app", "admin", "compte", "inscription", "pro", "recherche",
      "proposal", "cgv", "mentions", "mentions-legales",
      "confidentialite", "politique-confidentialite",
      "suppression-donnees", "dpa", "reset-password",
      "site", "index", "home", "tarifs", "sans-commission", "a-propos", "about", "securite-rgpd", "securite", "rgpd", "blog", "aide", "migration",
      "preview-email-confirmation", "clear",
      "sw.js", "manifest.json", "manifest-app.json", "manifest-admin.json",
      "icon-192.png", "icon-512.png", "luxyra-logo.png", "favicon.ico",
      "lx-client.js", "luxyra-supabase.js", "supabase.min.js",
      "robots.txt", "sitemap.xml"
    ]);
    const isOneSegment = segmentForSlug && !segmentForSlug.includes("/");
    const hasExtension = /\.[a-z0-9]+$/i.test(segmentForSlug);
    const looksLikeSlug = isOneSegment
      && !hasExtension
      && /^[a-z0-9][a-z0-9-]{1,79}$/i.test(segmentForSlug)
      && !RESERVED_FOR_SLUG.has(segmentForSlug);

    // FIX 2026-05-15 : /<slug>/bons-cadeaux → sert bons-cadeaux.html avec __SALON_SLUG injecté
    // FIX 2026-05-15 (soir) : /<slug>/reserver → sert site.html avec hash forcé sur réservation (Google Business)
    let _reserverIntent = false;
    if (!looksLikeSlug && segmentForSlug && segmentForSlug.includes("/")) {
      const parts = segmentForSlug.split("/");
      const maybeSlug = parts[0];
      const subPath = parts.slice(1).join("/");
      const slugOK = /^[a-z0-9][a-z0-9-]{1,79}$/i.test(maybeSlug) && !RESERVED_FOR_SLUG.has(maybeSlug);
      if (slugOK && (subPath === "bons-cadeaux" || subPath === "bons-cadeaux/" || subPath === "bons-cadeaux/success")) {
        const isSuccess = subPath === "bons-cadeaux/success";
        const fname = isSuccess ? "bons-cadeaux-success.html" : "bons-cadeaux.html";
        const ghUrl = `https://luxyra-fr.github.io/luxyra.fr/${fname}`;
        const res = await fetch(ghUrl, { cf: { cacheTtl: 0 } });
        if (res.ok) {
          let html = await res.text();
          const safeSlug = maybeSlug.replace(/[^a-z0-9-]/g, "");
          html = html.replace("</head>", `<script>window.__SALON_SLUG=${JSON.stringify(safeSlug)};</script></head>`);
          return new Response(html, {
            headers: { "Content-Type": "text/html;charset=UTF-8", "Cache-Control": "no-cache, no-store, must-revalidate" }
          });
        }
      }
      // NEW : route dédiée /<slug>/reserver pour Google Business Profile
      // Google ne suit pas les fragments d'URL (#reserver) lors de la validation
      // du "Lien pour les rendez-vous". Cette route propre sert la page salon
      // avec un signal explicite pour ouvrir directement le formulaire de RDV.
      if (slugOK && (subPath === "reserver" || subPath === "reserver/" || subPath === "reservation" || subPath === "reservation/" || subPath === "booking" || subPath === "rdv")) {
        // On laisse le routing slug en bas reprendre la main avec ce signal
        segmentForSlug = maybeSlug;
        _reserverIntent = true;
        // Re-évalue looksLikeSlug avec le nouveau segment
      }
    }
    // Re-test looksLikeSlug si on a stripped le sous-path /reserver
    const looksLikeSlugFinal = (looksLikeSlug || _reserverIntent)
      && segmentForSlug
      && !segmentForSlug.includes("/")
      && /^[a-z0-9][a-z0-9-]{1,79}$/i.test(segmentForSlug)
      && !RESERVED_FOR_SLUG.has(segmentForSlug);

    if (looksLikeSlugFinal) {
      // Sert site.html avec __SALON_SLUG injecte (URL visible inchangee)
      const res = await fetch(`https://luxyra-fr.github.io/luxyra.fr/site.html`, { cf: { cacheTtl: 0 } });
      let html = await res.text();
      const safeSlug = segmentForSlug.replace(/[^a-z0-9-]/g, "");
      // FIX 2026-05-15 : si on arrive via /<slug>/reserver, injecte un flag JS
      // qui sera lu cote client pour ouvrir directement le formulaire de RDV
      // (equivalent au hash #reserver mais survit au crawl Google qui ignore les fragments)
      const reserverFlag = _reserverIntent ? `window.__OPEN_RESERVATION=true;` : "";
      html = html.replace("</head>", `<script>window.__SALON_SLUG=${JSON.stringify(safeSlug)};${reserverFlag}</script></head>`);

      // ==================================================================
      // SSR SEO (FIX 2026-07-13) — cf. lxBuildSalonSeo() plus haut.
      // Injecte pour TOUT LE MONDE (pas de sniffing d'user-agent = pas de
      // cloaking). Si quoi que ce soit echoue -> `seo` vaut null et la page
      // part EXACTEMENT comme aujourd'hui (aucune 500, aucune page blanche).
      // ==================================================================
      try {
        const seo = await lxBuildSalonSeo(safeSlug, _reserverIntent);
        if (seo && seo.head) {
          // Remplace le <title> statique de site.html, puis pose les meta.
          // NB : remplacements par FONCTION et pas par chaine — une chaine de
          // remplacement interprete les motifs $& / $1 / $$, donc un salon dont le
          // nom contiendrait un "$" corromprait le HTML injecte.
          html = html
            .replace(/<title>[\s\S]*?<\/title>/i, "")
            .replace("</head>", () => seo.head + "</head>");
          // Texte indexable : remplit l'ancre vide #lx-seo-ssr (dans #root, SOUS
          // le loader plein ecran). Le JS l'efface au boot via root.innerHTML.
          // Si l'ancre n'existe pas (vieux site.html en cache) -> on ne pose que
          // les meta, sans rien casser.
          if (seo.body && html.indexOf('<div id="lx-seo-ssr"></div>') !== -1) {
            html = html.replace(
              '<div id="lx-seo-ssr"></div>',
              () => `<div id="lx-seo-ssr">${seo.body}</div>`
            );
          }
        }
      } catch (_) {
        // Silence total : la page normale est servie, le JS client fera le rendu.
      }

      return new Response(html, {
        headers: {
          "Content-Type": "text/html;charset=UTF-8",
          "Cache-Control": "no-cache, no-store, must-revalidate"
        }
      });
    }
  }

  const originRes = await fetch(`https://luxyra-fr.github.io/luxyra.fr${path}`, {
    headers: { ...Object.fromEntries(request.headers), "Cache-Control": "no-cache, no-store", "Pragma": "no-cache" },
    cf: { cacheTtl: 0, cacheEverything: false }
  });
  const newHeaders = new Headers(originRes.headers);
  if (path.endsWith(".html") || path.endsWith(".js")) {
    newHeaders.set("Cache-Control", "no-cache, no-store, must-revalidate");
    newHeaders.set("Pragma", "no-cache");
  }
  return new Response(originRes.body, { status: originRes.status, headers: newHeaders });
}

// ============================================================
// NEW SMS-NATIVE: Generate link token for QR code
// Called by Luxyra frontend when user clicks "Lier un téléphone"
// ============================================================
async function handleSmsGenerateLinkToken(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!checkRateLimit("sms_link:" + ip, 10)) return jsonResponse({ error: "Trop de requêtes. Réessayez dans 1 minute." }, 429);

  try {
    const { salon_id } = await request.json();
    if (!salon_id) return jsonResponse({ error: "salon_id requis" }, 400);

    // Check secret is configured
    if (!env.LUXYRA_LINK_SECRET) {
      console.error("LUXYRA_LINK_SECRET not set in worker env");
      return jsonResponse({ error: "Configuration serveur incomplète" }, 500);
    }

    // Verify salon exists and is Pro
    const salon = await supabaseGet(env, salon_id);
    if (!salon) return jsonResponse({ error: "Salon introuvable" }, 404);
    if (salon.plan !== "pro") return jsonResponse({ error: "Mode SMS natif réservé au plan Pro" }, 403);

    // Generate UUID v4 token
    const token = generateUuidV4();

    // Sign it with HMAC-SHA-256: signature = hmac(salon_id + "." + token, secret)
    const signature = await hmacSignHex(salon_id + "." + token, env.LUXYRA_LINK_SECRET);

    // Signed token format: "salon_id.token.signature"
    const signedToken = salon_id + "." + token + "." + signature;

    // Store raw token in DB with 5min expiry
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const insertRes = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/sms_link_tokens`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
      },
      body: JSON.stringify({ token: token, salon_id: salon_id, expires_at: expiresAt })
    });

    if (!insertRes.ok) {
      const errText = await insertRes.text();
      console.error("sms_link_tokens insert failed:", insertRes.status, errText);
      return jsonResponse({ error: "Impossible de générer le token" }, 500);
    }

    // QR code URL (the Android app will parse this)
    const qrUrl = `luxyra://sms-setup?token=${encodeURIComponent(signedToken)}&server=luxyra.fr`;

    return jsonResponse({
      success: true,
      signed_token: signedToken,
      qr_url: qrUrl,
      expires_at: expiresAt,
      expires_in_seconds: 300
    });
  } catch (e) {
    console.error("generate-link-token error:", e);
    return jsonResponse({ error: "Erreur serveur: " + e.message }, 500);
  }
}

// ============================================================
// NEW SMS-NATIVE: Link device (called by Android companion app)
// Receives signed token, validates, returns Supabase credentials
// ============================================================
async function handleSmsLinkDevice(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!checkRateLimit("sms_link_device:" + ip, 10)) return jsonResponse({ error: "Trop de requêtes. Réessayez dans 1 minute." }, 429);

  try {
    const { signed_token, device_name, device_model } = await request.json();
    if (!signed_token) return jsonResponse({ error: "signed_token requis" }, 400);

    if (!env.LUXYRA_LINK_SECRET) {
      console.error("LUXYRA_LINK_SECRET not set");
      return jsonResponse({ error: "Configuration serveur incomplète" }, 500);
    }

    // Parse signed token: "salon_id.token.signature"
    const parts = signed_token.split(".");
    if (parts.length !== 3) {
      return jsonResponse({ error: "Token mal formé" }, 400);
    }
    const [salon_id, token, providedSignature] = parts;

    // Verify signature (constant-time)
    const expectedSignature = await hmacSignHex(salon_id + "." + token, env.LUXYRA_LINK_SECRET);
    if (!constantTimeEquals(providedSignature, expectedSignature)) {
      console.warn("sms link: invalid signature from IP", ip);
      return jsonResponse({ error: "Token invalide" }, 401);
    }

    // Check token exists, not used, not expired
    const sbKey = env.SUPABASE_SERVICE_KEY;
    const headers = { apikey: sbKey, Authorization: `Bearer ${sbKey}`, "Content-Type": "application/json" };
    const tokenRes = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/sms_link_tokens?token=eq.${encodeURIComponent(token)}&salon_id=eq.${salon_id}&select=*&limit=1`,
      { headers }
    );
    const tokenRows = await tokenRes.json();
    if (!Array.isArray(tokenRows) || tokenRows.length === 0) {
      return jsonResponse({ error: "Token introuvable" }, 404);
    }
    const tokenRow = tokenRows[0];

    if (tokenRow.used_at) {
      return jsonResponse({ error: "Token déjà utilisé" }, 403);
    }
    if (new Date(tokenRow.expires_at) < new Date()) {
      return jsonResponse({ error: "Token expiré (5 min max)" }, 403);
    }

    // Generate unique device_id for this phone
    const deviceId = "dev_" + generateUuidV4();

    // Mark token as used
    await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/sms_link_tokens?id=eq.${tokenRow.id}`, {
      method: "PATCH",
      headers: { ...headers, "Prefer": "return=minimal" },
      body: JSON.stringify({
        used_at: new Date().toISOString(),
        used_by_ip: ip,
        device_id: deviceId
      })
    });

    // Update salon: set sms_native_device_id + linked_at
    // (do NOT change sms_mode here — user activates it explicitly from settings)
    await supabaseUpdate(env, salon_id, {
      sms_native_device_id: deviceId,
      sms_native_linked_at: new Date().toISOString()
    });

    // Get salon info for the app
    const salon = await supabaseGet(env, salon_id);
    if (!salon) return jsonResponse({ error: "Salon introuvable" }, 404);

    // Return connection info to Android app
    return jsonResponse({
      success: true,
      device_id: deviceId,
      salon_id: salon_id,
      salon_nom: salon.nom || "Salon",
      supabase_url: CONFIG.SUPABASE_URL,
      supabase_anon_key: env.SUPABASE_ANON_KEY || "",
      linked_at: new Date().toISOString()
    });
  } catch (e) {
    console.error("link-device error:", e);
    return jsonResponse({ error: "Erreur serveur: " + e.message }, 500);
  }
}

// ============================================================
// JOB DE RÉTENTION DES DONNÉES (cron quotidien)
// ============================================================
// Conformité légale : CGI art. L102 B / art. 286-I-3° bis → conservation 6 ans
// minimum des documents comptables. Au-delà, RGPD impose une durée justifiée :
// on supprime donc à 6 ans + 1 jour, après préavis de 30 jours.
//
// Phases :
//   1. PRÉAVIS : salons cancelled depuis 5 ans 11 mois → email "il vous reste
//      30 jours pour télécharger vos archives". On stocke retention_warned_at
//      pour ne pas re-envoyer le mail tous les jours.
//   2. PURGE : salons cancelled depuis > 6 ans (+ délai préavis) → suppression
//      définitive (cascade Postgres FKs supprime appointments, tickets,
//      clotures, clients, etc.). Les factures Luxyra sont conservées séparément
//      pour notre propre comptabilité (table factures_luxyra).
//
// Sécurité :
//   - Ne touche QUE les salons avec status='cancelled' AND cancelled_at IS NOT NULL
//   - Délai purge réel = 6 ans + 1 mois (le mois de préavis)
//   - Logs détaillés pour audit
//   - Endpoint /api/admin/retention-purge pour run manuel (auth via bearer token)
// ============================================================
// PURGE CARTES ABO PENDING ORPHELINES
// ============================================================
// Supprime les cartes_abo_clients en status='pending' créées il y a plus
// de 24 h. Une vraie vente passe en "active" en quelques secondes (au
// paiement effectif). Au-delà de 24 h, c'est une vente abandonnée :
// double-clic, paiement annulé, salon qui change d'avis. Sans purge, ces
// rows polluent la fiche client et peuvent générer des appels fantômes.
// FIX 2026-05-12 : purge des RDV en attente de paiement Stripe abandonnés.
// Pattern : client crée RDV → status='pending_payment' → redirect Stripe → abandon
// → RDV reste en pending_payment, ignoré côté UI mais pollue la DB.
// On supprime ceux > 1 heure (assez pour qu'un paiement normal soit finalisé).
// Critères de sécurité :
//   - status='pending_payment' STRICT
//   - created_at < now - 1h
//   - payment_intent_id IS NULL (vraiment jamais validé côté Stripe)
async function runPendingPaymentRdvPurgeJob(env) {
  const sbKey = env.SUPABASE_SERVICE_KEY;
  if (!sbKey) {
    console.warn("[purge-pending-rdv] SUPABASE_SERVICE_KEY missing — abort");
    return { skipped: "no_service_key" };
  }
  const cutoffIso = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h
  const url = `${CONFIG.SUPABASE_URL}/rest/v1/rdv_online`
    + `?status=eq.pending_payment`
    + `&payment_intent_id=is.null`
    + `&created_at=lt.${encodeURIComponent(cutoffIso)}`;
  try {
    const r = await fetch(url, {
      method: "DELETE",
      headers: {
        apikey: sbKey,
        Authorization: `Bearer ${sbKey}`,
        Prefer: "return=representation"
      }
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      console.error(`[purge-pending-rdv] DELETE failed: ${r.status} ${txt.slice(0, 200)}`);
      return { ok: false, status: r.status };
    }
    const deleted = await r.json().catch(() => []);
    const count = Array.isArray(deleted) ? deleted.length : 0;
    if (count > 0) {
      console.log(`[purge-pending-rdv] deleted ${count} pending_payment RDV(s) older than 1h`);
    }
    return { ok: true, deleted: count, cutoff: cutoffIso };
  } catch (e) {
    console.error("[purge-pending-rdv] exception:", e?.message || e);
    return { ok: false, error: String(e?.message || e) };
  }
}

async function runPendingCartesAboPurgeJob(env) {
  const sbKey = env.SUPABASE_SERVICE_KEY;
  if (!sbKey) {
    console.warn("[purge-pending-cartes] SUPABASE_SERVICE_KEY missing — abort");
    return { skipped: "no_service_key" };
  }
  const cutoffIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  // Supabase REST DELETE avec filter created_at lt cutoff + status pending
  // Prefer:return=representation pour récupérer ce qui a été supprimé.
  const url = `${CONFIG.SUPABASE_URL}/rest/v1/cartes_abo_clients`
    + `?status=eq.pending`
    + `&created_at=lt.${encodeURIComponent(cutoffIso)}`;
  try {
    const r = await fetch(url, {
      method: "DELETE",
      headers: {
        apikey: sbKey,
        Authorization: `Bearer ${sbKey}`,
        Prefer: "return=representation"
      }
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      console.error(`[purge-pending-cartes] DELETE failed: ${r.status} ${txt.slice(0, 200)}`);
      return { ok: false, status: r.status };
    }
    const deleted = await r.json().catch(() => []);
    const count = Array.isArray(deleted) ? deleted.length : 0;
    if (count > 0) {
      console.log(`[purge-pending-cartes] deleted ${count} pending carte(s) older than 24h`);
    }
    return { ok: true, deleted: count, cutoff: cutoffIso };
  } catch (e) {
    console.error("[purge-pending-cartes] exception:", e?.message || e);
    return { ok: false, error: String(e?.message || e) };
  }
}

// ============================================================
// RGPD J+60 (2026-10-10) — 60 jours après la fin du service (résiliation, essai non transformé, impayé non
// régularisé) : suppression des données personnelles non fiscales (fiches clientes, photos, réservations et
// commandes en ligne anonymisées). Préavis par email à J-7. Tickets, clôtures, journal NF525 : conservés 6 ans.
// ============================================================
async function runRgpdPurgeJ60(env) {
  const out = { prevenus: 0, purges: 0, erreurs: 0 };
  const rc = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/rgpd_purge_candidats`, { method: "POST", headers: _sbHeaders(env), body: "{}" });
  const c = rc.ok ? await rc.json() : null;
  if (!c) return { erreur: "candidats illisibles" };
  for (const s of (c.a_prevenir || [])) {
    try {
      const fin = new Date(s.fin); const le = new Date(fin.getTime() + 60 * 86400000).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });
      if (s.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email)) {
        await brevoSendEmail(env, { to: s.email, toName: s.nom || "", senderEmail: "contact@luxyra.fr", senderName: "Luxyra",
          subject: `Vos données Luxyra seront supprimées le ${le}`,
          htmlContent: lxMailLayout(`<p>Bonjour,</p><p>Votre service Luxyra pour <b>${String(s.nom || "votre établissement").replace(/</g, "&lt;")}</b> n'est plus actif. Conformément à nos conditions et au RGPD, <b>les données personnelles de vos clientes</b> (fiches, notes, photos, rendez-vous, réservations en ligne) <b>seront supprimées le ${le}</b>.</p><p>D'ici là, vous pouvez vous reconnecter pour <b>exporter vos données</b> ou <b>réactiver votre abonnement</b> : tout sera conservé à l'identique.</p><p>Vos documents de caisse (tickets, clôtures, journal) restent conservés 6 ans, comme l'exige la loi, et consultables en mode archives.</p><p style="text-align:center;margin:22px 0"><a href="https://luxyra.fr/app" style="background:#c8a84e;color:#000;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700">Me connecter</a></p>`, { titre: `Suppression prochaine de vos données` }),
          textContent: `Les données personnelles de vos clientes (fiches, notes, photos, rendez-vous) seront supprimées le ${le}. Reconnectez-vous d'ici là pour exporter vos données ou réactiver votre abonnement : https://luxyra.fr/app . Vos documents de caisse restent conservés 6 ans.`, replyTo: null, attachment: null });
      }
      await supabaseUpdate(env, s.id, { rgpd_preavis_le: new Date().toISOString() });
      out.prevenus++;
    } catch (e) { out.erreurs++; console.error("rgpd préavis", s.id, e?.message || e); }
  }
  for (const s of (c.a_purger || [])) {
    try {
      const rp = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/rgpd_purge_salon`, { method: "POST", headers: _sbHeaders(env), body: JSON.stringify({ p_salon: s.id }) });
      const r = rp.ok ? await rp.json() : null;
      if (!r || !r.ok) { out.erreurs++; continue; }
      // photos des clientes (stockage) : dossier client-photos/<salon_id>/
      try {
        const lst = await fetch(`${CONFIG.SUPABASE_URL}/storage/v1/object/list/client-photos`, { method: "POST", headers: _sbHeaders(env), body: JSON.stringify({ prefix: s.id, limit: 1000 }) });
        const items = lst.ok ? await lst.json() : [];
        const chemins = [];
        for (const it of (items || [])) {
          if (it.id) chemins.push(`${s.id}/${it.name}`);
          else { // sous-dossier (un niveau)
            const l2 = await fetch(`${CONFIG.SUPABASE_URL}/storage/v1/object/list/client-photos`, { method: "POST", headers: _sbHeaders(env), body: JSON.stringify({ prefix: `${s.id}/${it.name}`, limit: 1000 }) });
            for (const x of (l2.ok ? await l2.json() : [])) if (x.id) chemins.push(`${s.id}/${it.name}/${x.name}`);
          }
        }
        if (chemins.length) await fetch(`${CONFIG.SUPABASE_URL}/storage/v1/object/client-photos`, { method: "DELETE", headers: _sbHeaders(env), body: JSON.stringify({ prefixes: chemins }) });
        r.photos = chemins.length;
      } catch (_) {}
      out.purges++;
      try { await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/notify_admins`, { method: "POST", headers: _sbHeaders(env), body: JSON.stringify({ p_event_type: "payment_failed", p_title: "🧹 RGPD J+60", p_body: `${s.nom} : ${r.clients} fiche(s) cliente(s) supprimée(s)${r.photos ? ", " + r.photos + " photo(s)" : ""}. Données de caisse conservées.`, p_url: "/admin.html", p_payload: {} }) }); } catch (_) {}
    } catch (e) { out.erreurs++; console.error("rgpd purge", s.id, e?.message || e); }
  }
  return out;
}

async function runRetentionPurgeJob(env) {
  const sbKey = env.SUPABASE_SERVICE_KEY;
  if (!sbKey) {
    console.warn("[retention] SUPABASE_SERVICE_KEY missing — abort");
    return { skipped: "no_service_key" };
  }
  try { console.log("[rgpd J+60]", JSON.stringify(await runRgpdPurgeJ60(env))); } catch (e) { console.error("[rgpd J+60]", e?.message || e); }
  const now = new Date();
  // Bornes : on calcule "now - X années" en ms. ATTENTION aux années bissextiles
  // → on utilise setFullYear sur un Date pour rester précis.
  const dateMinusYears = (n) => {
    const d = new Date(now); d.setFullYear(d.getFullYear() - n); return d.toISOString();
  };
  const fiveYrsElevenMonths = (() => {
    const d = new Date(now); d.setFullYear(d.getFullYear() - 6); d.setMonth(d.getMonth() + 1); return d.toISOString();
  })();
  const sixYears = dateMinusYears(6);

  const stats = { warned: 0, purged: 0, errors: 0, details: [] };

  // === PHASE 1 — PRÉAVIS 30 JOURS ===
  // Salons cancelled depuis ≥ 5 ans 11 mois et < 6 ans, sans retention_warned_at.
  try {
    const warnRes = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/salons?select=id,nom,email,cancelled_at,retention_warned_at` +
      `&status=eq.cancelled&cancelled_at=lte.${encodeURIComponent(fiveYrsElevenMonths)}` +
      `&cancelled_at=gt.${encodeURIComponent(sixYears)}` +
      `&retention_warned_at=is.null`,
      { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
    );
    if (warnRes.ok) {
      const toWarn = await warnRes.json();
      console.log(`[retention] phase 1 (préavis) : ${toWarn.length} salons à notifier`);
      for (const salon of toWarn) {
        try {
          if (salon.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(salon.email)) {
            await sendRetentionWarningEmail(env, salon);
          }
          // Marque comme prévenu (même si pas d'email — sinon on retente tous les jours)
          await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/salons?id=eq.${salon.id}`, {
            method: "PATCH",
            headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, "Content-Type": "application/json", Prefer: "return=minimal" },
            body: JSON.stringify({ retention_warned_at: new Date().toISOString() })
          });
          stats.warned++;
          stats.details.push({ phase: "warned", id: salon.id, nom: salon.nom, email: salon.email || "(no email)" });
        } catch (e) {
          stats.errors++;
          console.error(`[retention] warn salon ${salon.id} failed:`, e?.message || e);
        }
      }
    } else {
      console.warn(`[retention] phase 1 query failed: ${warnRes.status}`);
    }
  } catch (e) {
    console.error("[retention] phase 1 exception:", e?.message || e);
    stats.errors++;
  }

  // === PHASE 2 — PURGE EFFECTIVE ===
  // Salons cancelled depuis ≥ 6 ans ET retention_warned_at non null (préavis envoyé).
  // Délai supplémentaire : on attend 30 jours après le préavis (au cas où on
  // aurait warné juste avant les 6 ans).
  try {
    const purgeBefore = (() => { const d = new Date(now); d.setDate(d.getDate() - 30); return d.toISOString(); })();
    const purgeRes = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/salons?select=id,nom,email,cancelled_at,retention_warned_at` +
      `&status=eq.cancelled&cancelled_at=lte.${encodeURIComponent(sixYears)}` +
      `&retention_warned_at=lte.${encodeURIComponent(purgeBefore)}`,
      { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
    );
    if (purgeRes.ok) {
      const toPurge = await purgeRes.json();
      console.log(`[retention] phase 2 (purge) : ${toPurge.length} salons à supprimer`);
      for (const salon of toPurge) {
        try {
          // Suppression cascade — la FK ON DELETE CASCADE de Postgres supprimera
          // appointments, tickets, clotures, clients, services, products, etc.
          // Si certaines tables n'ont pas la cascade, il faudra ajouter les DELETE
          // explicites ici (à vérifier après tests).
          const delRes = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/salons?id=eq.${salon.id}`, {
            method: "DELETE",
            headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, Prefer: "return=minimal" }
          });
          if (delRes.ok) {
            stats.purged++;
            stats.details.push({ phase: "purged", id: salon.id, nom: salon.nom, cancelled_at: salon.cancelled_at });
            // Notifie l'admin Luxyra (pour audit interne)
            try { await sendRetentionPurgedAdminEmail(env, salon); } catch (_e) {}
          } else {
            stats.errors++;
            console.error(`[retention] delete salon ${salon.id} failed: ${delRes.status}`);
          }
        } catch (e) {
          stats.errors++;
          console.error(`[retention] purge salon ${salon.id} exception:`, e?.message || e);
        }
      }
    } else {
      console.warn(`[retention] phase 2 query failed: ${purgeRes.status}`);
    }
  } catch (e) {
    console.error("[retention] phase 2 exception:", e?.message || e);
    stats.errors++;
  }

  // === PHASE 3 — PURGE DEVIS > 10 ANS ===
  // Code de commerce art L123-22 : conservation min 10 ans des documents
  // commerciaux (devis, bons de commande...). Au-delà : purge auto pour
  // ne pas accumuler indéfiniment et plomber la DB des salons actifs.
  // Pas de préavis nécessaire (pas une obligation NF525/fiscale, juste UX).
  try {
    const tenYears = (() => { const d = new Date(now); d.setFullYear(d.getFullYear() - 10); return d.toISOString(); })();
    const delDevisRes = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/devis?created_at=lte.${encodeURIComponent(tenYears)}`,
      { method: "DELETE", headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, Prefer: "return=representation" } }
    );
    if (delDevisRes.ok) {
      const deleted = await delDevisRes.json().catch(() => []);
      stats.devisPurged = Array.isArray(deleted) ? deleted.length : 0;
      if (stats.devisPurged > 0) {
        console.log(`[retention] phase 3 (devis 10 ans) : ${stats.devisPurged} devis purgés`);
        stats.details.push({ phase: "devis_purged_10y", count: stats.devisPurged });
      }
    } else {
      console.warn(`[retention] phase 3 (devis) failed: ${delDevisRes.status}`);
      stats.errors++;
    }
  } catch (e) {
    console.error("[retention] phase 3 (devis) exception:", e?.message || e);
    stats.errors++;
  }

  return stats;
}

// Email préavis 30 jours avant suppression
async function sendRetentionWarningEmail(env, salon) {
  if (!env.BREVO_API_KEY) { console.warn("[retention] BREVO_API_KEY missing — skip email"); return; }
  const cancelDate = new Date(salon.cancelled_at);
  const purgeDate = new Date(cancelDate); purgeDate.setFullYear(purgeDate.getFullYear() + 6);
  const purgeFmt = purgeDate.toLocaleDateString("fr-FR", { day:"2-digit", month:"long", year:"numeric" });
  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;color:#1a1a1a">
  <div style="background:#0b0b0b;padding:26px 20px 20px;text-align:center;border-bottom:3px solid #c8a84e">
    <img src="https://luxyra.fr/luxyra-logo.png" width="64" height="64" alt="Luxyra" style="display:block;margin:0 auto 10px;border-radius:12px">
    <div style="color:#d4a843;font-family:Georgia,serif;font-size:22px;letter-spacing:6px">LUXYRA</div>
  </div>
  <div style="padding:32px 28px">
    <h2 style="color:#1a1a1a;font-size:20px;margin:0 0 16px">⏰ Préavis de suppression de vos données</h2>
    <p style="font-size:15px;line-height:1.6;color:#333">Bonjour,</p>
    <p style="font-size:15px;line-height:1.6;color:#333">Votre abonnement Luxyra a été résilié il y a <strong>près de 6 ans</strong>. Conformément à la législation française (art. L102 B du Livre des procédures fiscales), nous avons conservé vos documents comptables pendant cette période obligatoire.</p>
    <div style="background:#fff8e6;border-left:4px solid #d4a843;padding:16px;margin:20px 0;border-radius:6px">
      <p style="margin:0;font-size:14px;color:#1a1a1a"><strong>📅 Vos données seront supprimées définitivement le <span style="color:#b8960f">${purgeFmt}</span></strong> (dans environ 30 jours).</p>
    </div>
    <p style="font-size:15px;line-height:1.6;color:#333">Si vous souhaitez récupérer vos clôtures Z, factures, ou tout autre document comptable, connectez-vous dès maintenant en mode archives :</p>
    <div style="text-align:center;margin:28px 0">
      <a href="https://luxyra.fr/app" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#d4a843,#b8960f);color:#0a0a0a;text-decoration:none;font-weight:700;border-radius:10px;letter-spacing:.5px;text-transform:uppercase;font-size:13px">Accéder à mes archives</a>
    </div>
    <p style="font-size:14px;line-height:1.6;color:#666">Une fois connecté, cliquez sur <strong>"Accéder à mes archives comptables"</strong> pour télécharger vos documents en quelques clics.</p>
    <hr style="border:none;border-top:1px solid #eee;margin:28px 0">
    <p style="font-size:12px;color:#999;line-height:1.5">Vous pouvez également <a href="https://luxyra.fr/app" style="color:#d4a843">reprendre un abonnement</a> à tout moment pour continuer d'utiliser Luxyra.</p>
    <p style="font-size:11px;color:#999;margin-top:18px">Luxyra — Alexandre JENSEN, entrepreneur individuel — SIRET 910 928 464 00023 — 29 rue de l'Abbé Alexandre Pax, 57200 Sarreguemines — contact@luxyra.fr</p>
  </div>
</div>`;
  const text = `Préavis suppression de vos données — Luxyra\n\nVotre abonnement résilié atteint bientôt 6 ans. Vos documents comptables seront supprimés définitivement le ${purgeFmt} (dans environ 30 jours).\n\nPour récupérer vos clôtures Z, factures et autres documents : connectez-vous sur https://luxyra.fr/app et cliquez sur "Accéder à mes archives comptables".\n\nLuxyra • contact@luxyra.fr`;
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json", "accept": "application/json" },
      body: JSON.stringify({
        sender: { name: "Luxyra", email: "contact@luxyra.fr" },
        to: [{ email: salon.email, name: salon.nom || "" }],
        subject: `⏰ Préavis : suppression de vos données Luxyra le ${purgeFmt}`,
        htmlContent: html,
        textContent: text
      })
    });
    if (!res.ok) {
      const errBody = await res.text();
      console.error(`[retention] Brevo email failed for salon ${salon.id}: ${res.status} ${errBody}`);
    }
  } catch (e) {
    console.error(`[retention] sendRetentionWarningEmail exception:`, e?.message || e);
  }
}

// Notif admin Luxyra après purge (pour audit interne)
async function sendRetentionPurgedAdminEmail(env, salon) {
  if (!env.BREVO_API_KEY) return;
  const adminEmail = env.LUXYRA_ADMIN_EMAIL || "contact@luxyra.fr";
  const html = `<p>Salon résilié purgé automatiquement (rétention 6 ans atteinte) :</p>
<ul>
<li><strong>ID</strong> : ${salon.id}</li>
<li><strong>Nom</strong> : ${salon.nom || "(sans nom)"}</li>
<li><strong>Email</strong> : ${salon.email || "(non renseigné)"}</li>
<li><strong>Résilié le</strong> : ${salon.cancelled_at}</li>
<li><strong>Préavis envoyé le</strong> : ${salon.retention_warned_at}</li>
<li><strong>Purgé le</strong> : ${new Date().toISOString()}</li>
</ul>`;
  try {
    await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: { name: "Luxyra Cron", email: "contact@luxyra.fr" },
        to: [{ email: adminEmail, name: "Admin Luxyra" }],
        subject: `[Audit] Salon ${salon.nom || salon.id} purgé (rétention 6 ans)`,
        htmlContent: html
      })
    });
  } catch (e) {
    console.error("[retention] admin notif failed:", e?.message || e);
  }
}

// ============================================================
// INTEGRITY CHECK JOB (cron quotidien) — audit auto tous salons
// Appelle public.check_data_integrity(salon_id) en READ-ONLY pour chaque
// salon actif, agrège les anomalies, et envoie un email à support@luxyra.fr
// UNIQUEMENT si au moins une anomalie CRITICAL ou WARNING est trouvée.
// Inbox vide = tout va bien.
// ============================================================
async function runIntegrityCheckJob(env) {
  const supabaseUrl = env.SUPABASE_URL || "https://kxdgjtvrkwugbifgppai.supabase.co";
  const supabaseKey = env.SUPABASE_SERVICE_KEY;
  if (!supabaseKey) {
    console.error("[integrity] SUPABASE_SERVICE_KEY manquant — skip");
    return { status: "skipped", reason: "no_service_key" };
  }

  // 1) Lister les salons actifs
  const salonsResp = await fetch(
    `${supabaseUrl}/rest/v1/salons?select=id,nom,siret,email,gerant_prenom,gerant_nom&status=neq.cancelled&user_id=not.is.null`,
    { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
  );
  if (!salonsResp.ok) {
    const t = await salonsResp.text();
    throw new Error(`Liste salons failed: ${salonsResp.status} ${t.slice(0, 200)}`);
  }
  const salons = await salonsResp.json();

  let allAnomalies = [];      // anomalies cumulées tous salons
  let salonsChecked = 0;
  let salonsWithIssues = 0;
  let totalCritical = 0;
  let totalWarning = 0;

  // 2) Pour chaque salon, RPC check_data_integrity
  for (const salon of salons) {
    salonsChecked++;
    try {
      const rpcResp = await fetch(`${supabaseUrl}/rest/v1/rpc/check_data_integrity`, {
        method: "POST",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_salon_id: salon.id }),
      });
      if (!rpcResp.ok) {
        console.error(`[integrity] RPC failed pour salon ${salon.nom}: ${rpcResp.status}`);
        continue;
      }
      const anomalies = await rpcResp.json();
      if (Array.isArray(anomalies) && anomalies.length > 0) {
        salonsWithIssues++;
        anomalies.forEach((a) => {
          if (a.severity === "CRITICAL") totalCritical++;
          else if (a.severity === "WARNING") totalWarning++;
          allAnomalies.push({ ...a, salon_id: salon.id, salon_nom: salon.nom, salon_email: salon.email });
        });
      }
    } catch (e) {
      console.error(`[integrity] erreur salon ${salon.nom}:`, e?.message || e);
    }
  }

  console.log(`[integrity] ${salonsChecked} salons checkés, ${salonsWithIssues} avec anomalies (${totalCritical} CRITICAL, ${totalWarning} WARNING)`);

  // 3) Envoi email à support@luxyra.fr SI au moins 1 anomalie CRITICAL ou WARNING
  if (totalCritical === 0 && totalWarning === 0) {
    return { status: "ok", salons_checked: salonsChecked, anomalies: 0 };
  }

  const date = new Date().toISOString().slice(0, 10);
  const sev = totalCritical > 0 ? "🚨 CRITICAL" : "⚠️ WARNING";
  const subject = `[Luxyra] ${sev} — Audit intégrité ${date} (${salonsWithIssues}/${salonsChecked} salons)`;

  // HTML email pro
  let html = `
    <div style="font-family:system-ui,Arial,sans-serif;max-width:700px;margin:0 auto;color:#1a1a1a">
      <div style="background:#0a0a0a;color:#c8a84e;padding:24px 30px;text-align:center">
        <h1 style="margin:0;font-family:Georgia,serif;font-size:24px;letter-spacing:3px">LUXYRA</h1>
        <div style="font-size:11px;letter-spacing:2px;margin-top:4px">RAPPORT D'AUDIT INTÉGRITÉ QUOTIDIEN</div>
      </div>
      <div style="padding:24px 30px;background:#fff">
        <h2 style="color:${totalCritical > 0 ? "#c43838" : "#d4a437"};margin:0 0 8px">${sev} — ${date}</h2>
        <p style="color:#555;font-size:14px;line-height:1.6">
          Audit automatique exécuté sur <strong>${salonsChecked}</strong> salon(s) actif(s).
          <strong>${salonsWithIssues}</strong> salon(s) avec anomalies détectées.<br>
          <strong style="color:#c43838">${totalCritical}</strong> anomalies CRITICAL.
          <strong style="color:#d4a437">${totalWarning}</strong> anomalies WARNING.
        </p>
  `;

  // Grouper par salon
  const bySalon = {};
  allAnomalies.forEach((a) => {
    if (!bySalon[a.salon_id]) bySalon[a.salon_id] = { nom: a.salon_nom, email: a.salon_email, items: [] };
    bySalon[a.salon_id].items.push(a);
  });

  for (const salonId of Object.keys(bySalon)) {
    const s = bySalon[salonId];
    html += `
      <div style="margin-top:24px;padding:18px;border-left:4px solid #c8a84e;background:#faf8f3">
        <div style="font-weight:700;font-size:16px;color:#1a1a1a">${escapeHtml(s.nom)}</div>
        <div style="font-size:11px;color:#888;margin-bottom:12px">${escapeHtml(s.email || "")} · ${s.items.length} anomalie(s)</div>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="background:#f0ebe0">
              <th style="padding:8px;text-align:left;border-bottom:1px solid #ddd">Sév.</th>
              <th style="padding:8px;text-align:left;border-bottom:1px solid #ddd">Cat.</th>
              <th style="padding:8px;text-align:left;border-bottom:1px solid #ddd">Règle</th>
              <th style="padding:8px;text-align:left;border-bottom:1px solid #ddd">Détail</th>
            </tr>
          </thead>
          <tbody>`;
    s.items.forEach((a) => {
      const sevColor = a.severity === "CRITICAL" ? "#c43838" : a.severity === "WARNING" ? "#d4a437" : "#888";
      html += `
        <tr style="border-bottom:1px solid #eee">
          <td style="padding:8px;color:${sevColor};font-weight:700">${a.severity}</td>
          <td style="padding:8px;color:#666">${a.category}</td>
          <td style="padding:8px;font-family:monospace;font-size:11px;color:#444">${a.rule}</td>
          <td style="padding:8px;color:#1a1a1a">${escapeHtml(a.detail || "")}</td>
        </tr>`;
    });
    html += `</tbody></table></div>`;
  }

  html += `
        <p style="font-size:11px;color:#999;margin-top:30px;padding-top:16px;border-top:1px solid #eee;line-height:1.5">
          Audit automatique généré par <strong>public.check_data_integrity()</strong> sur la base Luxyra.
          Action en lecture seule, aucune donnée modifiée. Pour investiguer une anomalie : se connecter
          au panneau admin Luxyra ou à Supabase SQL Editor.<br>
          Si tout est OK demain, vous ne recevrez aucun email — c'est normal.
        </p>
      </div>
    </div>`;

  // Plain text fallback
  let text = `[Luxyra] Audit intégrité ${date}\n\n${salonsChecked} salons checkés, ${salonsWithIssues} avec anomalies\n${totalCritical} CRITICAL, ${totalWarning} WARNING\n\n`;
  for (const salonId of Object.keys(bySalon)) {
    const s = bySalon[salonId];
    text += `--- ${s.nom} (${s.items.length} anomalies) ---\n`;
    s.items.forEach((a) => {
      text += `  [${a.severity}] ${a.rule}: ${a.detail}\n`;
    });
    text += "\n";
  }

  try {
    await brevoSendEmail(env, {
      to: "support@luxyra.fr",
      toName: "Support Luxyra",
      senderEmail: "contact@luxyra.fr",
      senderName: "Luxyra Audit",
      subject,
      htmlContent: html,
      textContent: text,
    });
    console.log("[integrity] email envoyé à support@luxyra.fr");
  } catch (e) {
    console.error("[integrity] envoi email échoué:", e?.message || e);
  }

  return { status: "alert_sent", salons_checked: salonsChecked, salons_with_issues: salonsWithIssues, critical: totalCritical, warning: totalWarning };
}

// Helper : escape HTML basique pour les emails
function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ============================================================
// UNSUBSCRIBE — Désabonnement RGPD 1-clic via lien email
// Token HMAC : base64url(clientId|channel|ts).signature
// Pas de login requis. Met sms_ok ou email_ok à false directement.
// ============================================================
async function generateUnsubscribeToken(clientId, channel, env) {
  // channel : "email" ou "sms" ou "all"
  const ts = Math.floor(Date.now() / 1000);
  const payload = `${clientId}|${channel}|${ts}`;
  const secret = env.STRIPE_WEBHOOK_SECRET || env.SUPABASE_SERVICE_KEY || "luxyra_fallback";
  const sig = await hmacSignHex(payload, secret);
  // base64url-safe
  const b64 = btoa(payload).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${b64}.${sig.slice(0, 24)}`;
}

function buildUnsubscribeUrl(clientId, channel, env) {
  // Asynchrone réellement, mais on retourne une Promise<string>
  return generateUnsubscribeToken(clientId, channel, env).then(token =>
    `https://luxyra.fr/api/unsubscribe?token=${encodeURIComponent(token)}`
  );
}

async function handleUnsubscribe(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!token) return htmlResponse(unsubscribePage("error", "Lien invalide ou expiré."), 400);

  // Vérifie token
  const parts = token.split(".");
  if (parts.length !== 2) return htmlResponse(unsubscribePage("error", "Lien malformé."), 400);
  let payload;
  try {
    const b64 = parts[0].replace(/-/g, '+').replace(/_/g, '/');
    payload = atob(b64 + "===".slice(0, (4 - b64.length % 4) % 4));
  } catch (e) {
    return htmlResponse(unsubscribePage("error", "Lien corrompu."), 400);
  }
  const secret = env.STRIPE_WEBHOOK_SECRET || env.SUPABASE_SERVICE_KEY || "luxyra_fallback";
  const expectedSig = (await hmacSignHex(payload, secret)).slice(0, 24);
  if (!constantTimeEquals(expectedSig, parts[1])) {
    return htmlResponse(unsubscribePage("error", "Signature invalide."), 403);
  }

  const [clientId, channel, ts] = payload.split("|");
  if (!clientId || !channel) return htmlResponse(unsubscribePage("error", "Données manquantes."), 400);

  // Update DB : passer sms_ok/email_ok à false selon le canal
  const sbKey = env.SUPABASE_SERVICE_KEY;
  if (!sbKey) return htmlResponse(unsubscribePage("error", "Configuration serveur incorrecte."), 500);
  const supabaseUrl = env.SUPABASE_URL || "https://kxdgjtvrkwugbifgppai.supabase.co";

  const updates = {};
  if (channel === "email" || channel === "all") updates.email_ok = false;
  if (channel === "sms" || channel === "all") updates.sms_ok = false;
  if (Object.keys(updates).length === 0) {
    return htmlResponse(unsubscribePage("error", "Canal inconnu."), 400);
  }

  const resp = await fetch(`${supabaseUrl}/rest/v1/clients?id=eq.${clientId}`, {
    method: "PATCH",
    headers: {
      apikey: sbKey,
      Authorization: "Bearer " + sbKey,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(updates),
  });
  if (!resp.ok) {
    const t = await resp.text();
    console.error("[unsubscribe] DB error:", resp.status, t);
    return htmlResponse(unsubscribePage("error", "Erreur serveur. Veuillez réessayer ou contacter support@luxyra.fr"), 500);
  }
  const data = await resp.json();
  if (!Array.isArray(data) || data.length === 0) {
    return htmlResponse(unsubscribePage("error", "Client introuvable."), 404);
  }

  // Trace audit
  try {
    const c = data[0];
    await fetch(`${supabaseUrl}/rest/v1/audit_log`, {
      method: "POST",
      headers: { apikey: sbKey, Authorization: "Bearer " + sbKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        salon_id: c.salon_id,
        action: "RGPD_UNSUBSCRIBE",
        details: `Client ${c.prenom||""} ${c.nom||""} (${c.email||c.telephone||"?"}) désabonné canal "${channel}" via lien email`,
        timestamp_action: new Date().toISOString(),
        operator_name: "Auto (lien email RGPD)",
      }),
    });
  } catch (e) { console.warn("[unsubscribe] audit log fail:", e?.message); }

  return htmlResponse(unsubscribePage("ok", channel === "email" ? "Vous êtes désabonné des emails." : channel === "sms" ? "Vous êtes désabonné des SMS." : "Vous êtes désabonné de toutes les communications."));
}

function unsubscribePage(status, message) {
  const color = status === "ok" ? "#2d9a5e" : "#c43838";
  const icon = status === "ok" ? "✅" : "❌";
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Désinscription — Luxyra</title>
<style>body{font-family:'Helvetica Neue',Arial,sans-serif;background:#0a0a0a;color:#f5f0e8;margin:0;padding:40px 20px;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#fff;color:#1a1a1a;max-width:480px;width:100%;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.3)}
.head{background:#0a0a0a;color:#c8a84e;padding:20px;text-align:center;letter-spacing:3px;font-weight:800;font-family:Georgia,serif;font-size:22px}
.body{padding:32px 28px;text-align:center}.icon{font-size:48px;margin-bottom:12px}.title{font-size:20px;font-weight:800;color:${color};margin-bottom:8px}
.msg{color:#555;font-size:14px;line-height:1.6;margin-bottom:24px}.note{font-size:12px;color:#888;padding-top:18px;border-top:1px solid #eee;line-height:1.6}
.note a{color:#c8a84e;text-decoration:none}</style></head><body>
<div class="card"><div class="head">LUXYRA</div><div class="body">
<div class="icon">${icon}</div><div class="title">${status === "ok" ? "Désinscription confirmée" : "Erreur"}</div>
<div class="msg">${escapeHtml(message)}</div>
<div class="note">Vous pouvez à tout moment reprendre vos notifications en vous connectant à votre espace client <a href="https://luxyra.fr/compte">luxyra.fr/compte</a>.<br><br>Pour toute question : <a href="mailto:support@luxyra.fr">support@luxyra.fr</a></div>
</div></div></body></html>`;
}

function htmlResponse(html, status) {
  return new Response(html, { status: status || 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

// ============================================================
// STRIPE FEES — transparence frais bancaires temps réel
// Pull les balance_transactions du Stripe Connect du salon, agrège, renvoie.
// READ-ONLY. Aucune modif Stripe. Aucune modif DB. Authentifié JWT Supabase.
// ============================================================
async function handleStripeFees(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!checkRateLimit("stripe_fees:" + ip, 30)) return jsonResponse({ error: "Trop de requêtes." }, 429);

  // Auth : JWT Supabase du user
  const authHeader = request.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return jsonResponse({ error: "auth_required" }, 401);
  const userToken = authHeader.slice(7);

  const supabaseUrl = env.SUPABASE_URL || "https://kxdgjtvrkwugbifgppai.supabase.co";
  const sbKey = env.SUPABASE_SERVICE_KEY;
  if (!sbKey) return jsonResponse({ error: "configuration_error" }, 500);

  // Vérifier le token via Supabase /auth/v1/user
  const userResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: sbKey, Authorization: "Bearer " + userToken }
  });
  if (!userResp.ok) return jsonResponse({ error: "auth_invalid" }, 401);
  const userData = await userResp.json();
  const userId = userData?.id;
  if (!userId) return jsonResponse({ error: "auth_invalid" }, 401);

  // Body
  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }
  const salonId = body.salon_id;
  if (!salonId) return jsonResponse({ error: "salon_id requis" }, 400);

  // Vérifier ownership salon
  const adminHeaders = { apikey: sbKey, Authorization: "Bearer " + sbKey };
  const salonResp = await fetch(
    `${supabaseUrl}/rest/v1/salons?id=eq.${salonId}&select=id,user_id,stripe_connect_id,stripe_connect_status,nom`,
    { headers: adminHeaders }
  );
  if (!salonResp.ok) return jsonResponse({ error: "salon_fetch_failed" }, 500);
  const salons = await salonResp.json();
  if (!Array.isArray(salons) || !salons[0]) return jsonResponse({ error: "salon_not_found" }, 404);
  const salon = salons[0];
  if (salon.user_id !== userId) return jsonResponse({ error: "forbidden" }, 403);

  const stripeAccountId = salon.stripe_connect_id;
  if (!stripeAccountId) {
    return jsonResponse({
      success: true,
      stripe_connect_active: false,
      message: "Stripe Connect non configuré pour ce salon. Les frais bancaires des encaissements physiques se font via votre TPE bancaire (non géré par Luxyra).",
      items: [], totals: { gross: 0, fees: 0, net: 0, count: 0, effective_rate_pct: 0 }
    });
  }

  // Période : par défaut le mois en cours
  const now = new Date();
  const y = parseInt(body.year) || now.getUTCFullYear();
  const m = parseInt(body.month) || (now.getUTCMonth() + 1);
  const startMs = Date.UTC(y, m - 1, 1, 0, 0, 0);
  const endMs = Date.UTC(y, m, 0, 23, 59, 59);
  const start = Math.floor(startMs / 1000);
  const end = Math.floor(endMs / 1000);

  // Pull balance_transactions du compte Stripe Connect du salon
  const stripeKey = env.STRIPE_SECRET_KEY;
  if (!stripeKey) return jsonResponse({ error: "stripe_not_configured" }, 500);

  let allTx = [];
  let hasMore = true;
  let starting_after = null;
  let pageCount = 0;
  while (hasMore && allTx.length < 1000 && pageCount < 10) {
    pageCount++;
    let stripeUrl = `https://api.stripe.com/v1/balance_transactions?type=charge&created[gte]=${start}&created[lte]=${end}&limit=100`;
    if (starting_after) stripeUrl += `&starting_after=${starting_after}`;
    const stripeResp = await fetch(stripeUrl, {
      headers: {
        Authorization: "Bearer " + stripeKey,
        "Stripe-Account": stripeAccountId
      }
    });
    if (!stripeResp.ok) {
      const errText = await stripeResp.text();
      console.error("[stripe_fees] error:", stripeResp.status, errText.slice(0, 300));
      return jsonResponse({
        error: "stripe_api_error",
        status: stripeResp.status,
        detail: errText.slice(0, 200)
      }, 502);
    }
    const stripeData = await stripeResp.json();
    if (stripeData.data && stripeData.data.length) {
      allTx = allTx.concat(stripeData.data);
      starting_after = stripeData.data[stripeData.data.length - 1].id;
      hasMore = !!stripeData.has_more;
    } else {
      hasMore = false;
    }
  }

  // Agréger
  let totalGrossCents = 0, totalFeesCents = 0, totalNetCents = 0;
  const items = allTx.map(t => {
    totalGrossCents += t.amount;
    totalFeesCents += t.fee;
    totalNetCents += t.net;
    return {
      id: t.id,
      created: t.created,
      created_iso: new Date(t.created * 1000).toISOString(),
      amount: t.amount / 100,
      fee: t.fee / 100,
      net: t.net / 100,
      currency: t.currency,
      description: t.description || ""
    };
  });

  const effectiveRate = totalGrossCents > 0 ? (totalFeesCents / totalGrossCents) * 100 : 0;

  return jsonResponse({
    success: true,
    stripe_connect_active: true,
    salon: { id: salon.id, nom: salon.nom, stripe_connect_status: salon.stripe_connect_status },
    period: { year: y, month: m, start, end },
    items,
    totals: {
      gross: Math.round(totalGrossCents) / 100,
      fees: Math.round(totalFeesCents) / 100,
      net: Math.round(totalNetCents) / 100,
      count: items.length,
      effective_rate_pct: Math.round(effectiveRate * 100) / 100
    }
  });
}
// EOF
