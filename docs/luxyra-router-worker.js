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
  // 2026-10-14 SECURITE : get_monitoring_status n'est plus exécutable par anon -> appel avec la clé service
  const SB_ANON = env.SUPABASE_SERVICE_KEY || env.SUPABASE_ANON_KEY || "";
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
      // 2026-10-17 : webhook global Brevo (réponses STOP / START aux SMS publicitaires)
      if (url.pathname === "/api/brevo/sms-stop" && request.method === "POST") return await handleBrevoSmsStopWebhook(request, env);
      if (url.pathname === "/api/sms/recharge-auto" && request.method === "POST") return await handleSmsRechargeAuto(request, env);
      if (url.pathname === "/api/stripe/portal" && request.method === "POST") return await handlePortal(request, env);
      if (url.pathname === "/api/stripe/switch-plan" && request.method === "POST") return await handleSwitchPlan(request, env);
      if (url.pathname === "/api/admin/offer-month" && request.method === "POST") return await handleOfferMonth(request, env);
      if (url.pathname === "/api/admin/stripe" && request.method === "POST") return await handleAdminStripe(request, env);
      // 2026-10-15 : crédits restants du compte Brevo Luxyra (admin seulement, lecture seule)
      if (url.pathname === "/api/admin/brevo" && request.method === "GET") return await handleAdminBrevo(request, env, url);
      // 2026-10-17 soir : STOP SMS — réinscription d'un numéro, déblocage Brevo des rappels (admin ou x-lx-internal)
      if (url.pathname === "/api/admin/sms-stop" && request.method === "POST") return await handleAdminSmsStop(request, env);
      // 2026-10-15 : statistiques e-mails Brevo (7 / 30 j) et état des automatismes GitHub (admin seulement, lecture seule)
      if (url.pathname === "/api/admin/brevo-emails" && request.method === "GET") return await handleAdminBrevoEmails(request, env, url);
      if (url.pathname === "/api/admin/github-actions" && request.method === "GET") return await handleAdminGithubActions(request, env, url);
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
      // 2026-10-14 audit : bons cadeaux (succès + espace client) et avis du client
      if (url.pathname === "/api/bons-cadeaux/statut" && request.method === "POST") return await handleBonCadeauStatut(request, env);
      if (url.pathname === "/api/client/bons-cadeaux" && request.method === "POST") return await handleClientBonsCadeaux(request, env);
      if (url.pathname === "/api/client/avis" && request.method === "POST") return await handleClientAvis(request, env);
      // FIX 2026-05-13 : Export NF525 (conservation 6 ans / audit fiscal)
      if (url.pathname === "/api/admin/export-nf525" && request.method === "POST") return await handleExportNF525(request, env);
      // FIX 2026-05-12 : Path A empreinte (post-Checkout, stocke le PI ID dans rdv_online)
      if (url.pathname === "/api/stripe/empreinte-finalize" && request.method === "POST") return await handleEmpreinteFinalize(request, env);
      // FIX 2026-05-23 : Path A acompte (post-Checkout, stocke le PI ID → remboursement auto possible)
      if (url.pathname === "/api/stripe/acompte-finalize" && request.method === "POST") return await handleAcompteFinalize(request, env);
      if (url.pathname === "/api/rdv/acompte-info" && request.method === "POST") return await handleRdvAcompteInfo(request, env);
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
      if (url.pathname === "/api/unsubscribe" && (request.method === "GET" || request.method === "POST")) return await handleUnsubscribe(request, env); // 2026-10-17 : GET = confirmation, POST = désinscription
      // Endpoints espace client compte.html — bypass RLS via service_role
      // après vérification du session_token JWT (issu de lx-login/lx-signup).
      // Permet de DROP les policies anon USING(true) qui leakaient toutes les
      // données client cross-salons à n'importe quel détenteur de l'anon key.
      if (url.pathname === "/api/client/cartes" && request.method === "POST") return await handleClientCartes(request, env);
      if (url.pathname === "/api/client/fidelite" && request.method === "POST") return await handleClientFidelite(request, env);
      if (url.pathname === "/api/client/rdvs" && request.method === "POST") return await handleClientRdvs(request, env);
      if (url.pathname === "/api/client/favoris" && request.method === "POST") return await handleClientFavoris(request, env);
      if (url.pathname.startsWith("/api/salon-logo/") && request.method === "GET") return await handleSalonLogo(url.pathname.slice(16).replace(/\.png$/, ""), env);
      if (url.pathname === "/api/client/alertes" && request.method === "POST") return await handleClientAlertes(request, env);
      if (url.pathname === "/api/client/notifs" && request.method === "POST") return await handleClientNotifs(request, env);
      if (url.pathname === "/api/rdv/acompte-rembourser" && request.method === "POST") return await handleAcompteRembourser(request, env);
      if (url.pathname === "/api/alertes/creneau-libere" && request.method === "POST") return await handleCreneauLibere(request, env);
      if (url.pathname === "/api/client/rdv-update" && request.method === "POST") return await handleClientRdvUpdate(request, env);
      if (url.pathname === "/api/client/anonymize" && request.method === "POST") return await handleClientAnonymize(request, env);
      // Invitations clients (magic link "créer mot de passe")
      if (url.pathname === "/api/client/invite" && request.method === "POST") return await handleClientInvite(request, env);
      if (url.pathname === "/api/client/invite/verify" && request.method === "POST") return await handleClientInviteVerify(request, env);
      if (url.pathname === "/api/salon/availability" && request.method === "POST") return await handleSalonAvailability(request, env);
      if (url.pathname === "/api/rdv/cancel" && request.method === "POST") return await handleRdvCancel(request, env);
      // 2026-10-14 SECURITE (audit) : remplacent des accès anonymes directs à la base
      if (url.pathname === "/api/client/salons" && request.method === "POST") return await handleClientSalons(request, env);
      if (url.pathname === "/api/rdv/abandon" && request.method === "POST") return await handleRdvAbandon(request, env);
      if (url.pathname === "/api/inscription/email-check" && request.method === "POST") return await handleInscriptionEmailCheck(request, env);
      if (url.pathname === "/api/annuaire/signaler" && request.method === "POST") return await handleAnnuaireSignaler(request, env);
      if (url.pathname === "/api/annuaire/retrait" && request.method === "POST") return await handleAnnuaireRetrait(request, env);
      // Endpoint admin pour déclencher manuellement le job de rétention (debug/test).
      // Sécurisé par un secret bearer token dans env.RETENTION_ADMIN_TOKEN.
      // 2026-10-15 : aussi déclenchable depuis le panneau admin (session support@luxyra.fr + double authentification),
      // bouton « Lancer maintenant » de la page RGPD & purges. Le job ne traite que les candidats déjà dus
      // (préavis envoyés, délais écoulés) : mêmes règles que la tâche de nuit, rien n'est forcé.
      if (url.pathname === "/api/admin/retention-purge" && request.method === "POST") {
        const auth = request.headers.get("Authorization") || "";
        let parAdmin = null;
        if (!(env.RETENTION_ADMIN_TOKEN && lxEgal(auth, `Bearer ${env.RETENTION_ADMIN_TOKEN}`))) {
          const u = await lxAuthUser(request);
          if (!u || !lxIsAdminUser(u)) return jsonResponse({ error: "unauthorized" }, 401);
          parAdmin = String(u.email || "admin");
        }
        const result = await runRetentionPurgeJob(env);
        if (parAdmin) {
          try {
            await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/admin_log`, { method: "POST", headers: _sbHeaders(env, { Prefer: "return=minimal" }),
              body: JSON.stringify({ action: "RETENTION_MANUELLE", admin_email: parAdmin, cible: "conservation", details: JSON.stringify({ warned: result.warned, purged: result.purged, errors: result.errors, devis: result.devisPurged || 0 }).slice(0, 1000) }) });
          } catch (_) {}
        }
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
      // 2026-10-17 audit réglages (#4) : lien de désinscription (pied des e-mails, SMS publicitaires)
      // 2026-10-17 lien court : SMS « Stop SMS: luxyra.fr/s/<code 6 [a-z0-9]> » ; anciens liens /stop/<10 hex> toujours valides.
      // GET = page de confirmation (rien n'est fait à la simple ouverture), POST = désinscription.
      { const _stop = url.pathname.match(/^\/stop\/([0-9a-f]{10}|[a-z0-9]{6})\/?$/) || url.pathname.match(/^\/s\/([a-z0-9]{6})\/?$/);
        if (_stop && (request.method === "GET" || request.method === "POST")) return await lxPageStop(request, env, _stop[1], url.pathname.startsWith("/s/") ? "/s/" : "/stop/"); }
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
      // 2026-10-17 : réponses STOP / START des 2 derniers jours (API d'événements SMS Brevo) -> lx_sms_stop
      try { console.log("[cron] STOP SMS:", await lxSmsStopRattrapage(env)); }
      catch (err) { await reportWorkerError(env, "cron:sms-stop", err, null, "warning"); }
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
    // 2026-10-14 SECURITE : email_verified transmis. Tant que l'email n'est pas vérifié, AUCUNE donnée n'est
    // rattachée au compte par l'email (rendez-vous, tickets, cartes, fidélité, annulation…) : seulement par lx_id.
    // (lx-profile vérifie aussi la version de session : jeton refusé après changement de mot de passe.)
    return { lx_id: String(u.id), email: String(u.email || "").toLowerCase().trim(), email_verified: u.email_verified === true };
  } catch (e) {
    console.error("[verifyClientSession] exception:", e?.message || e);
    return null;
  }
}

// 2026-10-14 : email utilisable pour rattacher des données au compte = seulement s'il est vérifié (sinon "")
function lxEmailVerifie(session) { return session && session.email_verified === true && session.email ? session.email : ""; }

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
// 2026-10-14 SECURITE : aal2 désormais EXIGÉ dans tous les cas (la double authentification est activée sur
// support@luxyra.fr ; un compte admin sans second facteur n'a plus aucun droit admin) — aligné sur public.is_admin().
function lxIsAdminUser(u) {
  if (!(u && String(u.email || "").toLowerCase() === "support@luxyra.fr")) return false;
  return u._aal === "aal2";
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
  "/api/client/invite", "/api/cc/action", "/api/sms/recharge-auto", "/api/rdv/acompte-rembourser"
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
      // 2026-10-08 : Click & Collect payé en ligne (filet si le client ferme l'onglet avant le retour)
      if (data.metadata?.type === "click_collect") {
        try { await ccFinaliserPaiement(env, data.metadata.commande_id, data); } catch (e) { console.error("cc finalize webhook:", e); }
        break;
      }
      // FAILLE CORRIGÉE 2026-10-08 : TOUT paiement Checkout portant un salon_id (acompte d'un client,
      // bon cadeau, carte...) passait ici comme un ABONNEMENT : le salon passait Pro/actif, et son
      // véritable abonnement Luxyra était ANNULÉ chez Stripe (anti-double-facturation de updateSalonPlan).
      // Seules les sessions d'abonnement modifient le forfait.
      if (data.mode !== "subscription" || !data.subscription) break;
      if (salonId) {
        // 2026-10-17 audit réglages (#1) : forfait AVANT l'abonnement (réouverture du site seulement si on passe en Pro)
        let _ancienPlan = "pro";
        try { const _av = await supabaseGet(env, salonId); _ancienPlan = (_av && _av.status !== "cancelled") ? (_av.plan || "essential") : "essential"; } catch (_) {}
        await updateSalonPlan(env, salonId, plan, data.subscription, data.customer);
        if (plan === "pro") { try { await lxSiteApresPassagePro(env, salonId, _ancienPlan); } catch (e) { console.warn("[site après Pro]", e?.message); } }
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
        await lxSiteCouperForfait(env, salonId);  // 2026-10-17 audit réglages (#1) : état mémorisé pour le retour en Pro
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
        // 2026-10-17 audit réglages (#1) : cet évènement arrive aussi à CHAQUE renouvellement mensuel. Avant, il remettait
        // site_actif / reservation_active à true pour tout salon Pro (un salon fermé pour congés était rouvert).
        // Désormais : coupure seulement en passant en Essentiel ; réouverture seulement lors d'un vrai passage Essentiel -> Pro.
        if (newPlan !== "pro") { if (!salon || salon.plan === "pro") await lxSiteCouperForfait(env, salonId); }
        else await lxSiteApresPassagePro(env, salonId, salon ? salon.plan : "pro");
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
          // 2026-10-14 audit : même codification partout (avant : « payouts_pending » jamais écrit ici -> salon
          // qui encaissait affiché « vérification en cours » et acompte coupé sur le site)
          const status = lxConnectStatut(data);
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
      // 2026-10-17 audit réglages (#1) : jamais de réactivation de ce que le pro a coupé (voir lxSiteApresPassagePro)
      if (plan !== "pro") { if (salon.plan === "pro") await lxSiteCouperForfait(env, salon_id); }
      else await lxSiteApresPassagePro(env, salon_id, salon.plan);
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
// 2026-10-14 audit : statut Stripe Connect d'un compte — UNE seule codification pour les deux webhooks
// (plateforme + Connect), handleConnectStatus et le contrôle quotidien. « payouts_pending » = le salon
// encaisse déjà (charges_enabled), seuls les virements attendent la validation du RIB.
function lxConnectStatut(acc) {
  const ch = !!(acc && acc.charges_enabled), po = !!(acc && acc.payouts_enabled), de = !!(acc && acc.details_submitted);
  return ch && po ? "active" : (ch ? "payouts_pending" : (de ? "pending_verification" : "incomplete"));
}

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

    // 2026-10-14 audit : codification unique (lxConnectStatut), identique aux webhooks et au contrôle quotidien
    const status = lxConnectStatut(account);

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
    const _body = await readJsonBody(request);
    const { salon_id, description, customer_email, customer_name, metadata, capture_method } = _body;
    // 2026-10-14 audit : le montant d'un acompte / d'une empreinte n'est plus celui envoyé par le navigateur : il est relu en
    // base (rdv_online.acompte_montant / empreinte_amount) ; un écart avec le montant demandé est refusé.
    let amount = _body.amount;
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
        const _r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rdv_online?select=id,salon_id,status,acompte_paye,acompte_montant,empreinte_amount,empreinte_status&id=eq.${encodeURIComponent(_rid)}&limit=1`, { headers: _sbHeaders(env) });
        const _a = _r.ok ? await _r.json() : [];
        if (!Array.isArray(_a) || !_a[0] || String(_a[0].salon_id) !== String(salon_id)) return jsonResponse({ error: "Rendez-vous introuvable pour ce salon" }, 400);
        // 2026-10-11 : jamais de paiement pour un RDV annulé / refusé / terminé, ni d'acompte déjà payé
        if (!["pending", "pending_payment", "confirmed"].includes(String(_a[0].status || ""))) return jsonResponse({ error: "Ce rendez-vous n'est plus actif" }, 409);
        if (_type === "acompte" && _a[0].acompte_paye === true) return jsonResponse({ error: "L'acompte de ce rendez-vous est déjà réglé" }, 409);
        // 2026-10-14 audit (caisse + site) : montant = valeur ENREGISTRÉE sur le rendez-vous (calculée par la base à
        // l'insertion, jamais celle du navigateur) ; un écart avec le montant demandé est refusé et journalisé.
        const _estEmpreinte = _type === "empreinte" || capture_method === "manual";
        const _mtBase = Math.round((Number(_estEmpreinte ? _a[0].empreinte_amount : _a[0].acompte_montant) || 0) * 100);
        if (!(_mtBase > 0)) return jsonResponse({ error: _estEmpreinte ? "Aucune empreinte n'est prévue pour ce rendez-vous" : "Aucun acompte n'est dû pour ce rendez-vous" }, 409);
        if (_estEmpreinte && !["none", "pending", null, undefined, ""].includes(_a[0].empreinte_status)) return jsonResponse({ error: "L'empreinte de ce rendez-vous est déjà enregistrée" }, 409);
        // Tolérance d'arrondi : 1 centime (le navigateur et la base peuvent arrondir différemment) ; le montant
        // facturé reste TOUJOURS celui de la base (_mtBase).
        if (!(Math.abs(Math.round(Number(amount) * 100) - _mtBase) <= 1)) {
          await reportWorkerError(env, "worker:connect-payment", new Error("Montant demandé différent du montant enregistré"), { rdv_id: _rid, demande: Math.round(Number(amount) * 100), enregistre: _mtBase, type: _type }, "warning");
          return jsonResponse({ error: "Montant incohérent avec le rendez-vous : rechargez la page." }, 409);
        }
        amount = _mtBase / 100;
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
      // 2026-10-13 : page de paiement valable 31 min (le créneau en attente de paiement est bloqué 35 min)
      expires_at: String(Math.floor(Date.now() / 1000) + 31 * 60),
    };
    // 2026-10-09 : charge directe sur le compte du salon (ou ancien mode destination si interrupteur OFF)
    const _direct = await lxChargesDirectes(env);
    lxParamsPaiementSalon(sessionParams, _direct, salon.stripe_connect_id);
    // Empreinte : capture manuelle (pré-autorisation, débit différé)
    if (capture_method === "manual") {
      sessionParams["payment_intent_data[capture_method]"] = "manual";
      sessionParams["metadata[subtype]"] = "empreinte";
    }
    lxBrandingSalon(sessionParams, salon);
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
      <div style="color:#8c8270;font-size:11px;letter-spacing:1px;margin-top:4px">GESTION &amp; CAISSE POUR LES PROFESSIONNELS DE LA BEAUTÉ ET DU BIEN-ÊTRE</div>
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
    const pr = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/produits?select=id,nom,prix,promo_actif,promo_prix,promo_debut,promo_fin,stock,actif,for_sale,coup_coeur&salon_id=eq.${encodeURIComponent(b.salon_id)}&id=in.(${ids.join(",")})`, { headers: _sbHeaders(env) });
    const prods = pr.ok ? await pr.json() : [];
    const items = []; let total = 0;
    for (const d of demandes) {
      const p = (prods || []).find((x) => Number(x.id) === d.id);
      // 2026-10-17 audit réglages (#23) : l'ancienne liste site_config.produits_en_ligne (plus modifiable depuis l'app)
      // ne filtre plus : seul « Disponible en Click & Collect » (coup_coeur) + vente + actif comptent.
      if (!p || p.actif === false || p.for_sale === false || p.coup_coeur !== true) return jsonResponse({ error: "Un produit n'est plus disponible à la vente" }, 409);
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
    lxBrandingSalon(params, salon);
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
      if (!maj && !cmd.paye) { const re = await ccLire(env, cmd.id); if (re && re.paye && re.status !== "annulee") return jsonResponse({ error: "Le client vient de payer cette commande : relancez l'annulation pour la rembourser.", commande: re }, 409); }
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

// POST /api/client/commandes {session_token} — commandes du client connecté
async function handleClientCommandes(request, env) {
  try {
    const { session_token } = await readJsonBody(request);
    const session = await verifyClientSession(session_token, env);
    if (!session) return jsonResponse({ error: "Session invalide" }, 401);
    const q = `${CONFIG.SUPABASE_URL}/rest/v1/commandes_online?select=id,salon_id,numero,items,total,status,paye,mode_paiement,code_retrait,created_at,ready_at,collected_at,cancelled_at&${lxEmailVerifie(session) ? `or=(client_luxyra_id.eq.${encodeURIComponent(session.lx_id)},client_email.eq.%22${encodeURIComponent(session.email)}%22)` : `client_luxyra_id=eq.${encodeURIComponent(session.lx_id)}`}&status=neq.pending_payment&order=created_at.desc&limit=50`;
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
// 2026-10-14 audit — BONS CADEAUX (page de succès + espace client) ET AVIS DU CLIENT
// ============================================================
// cartes_cadeaux n'est lisible que par le salon (RLS) : la page de succès et l'onglet « Bons cadeaux »
// de compte.html lisaient la table en anon -> toujours vide. Lecture désormais par le worker.
function lxMasquerEmail(e) {
  const m = String(e || "").match(/^([^@]{0,2})[^@]*(@.*)$/);
  return m ? m[1] + "•••" + m[2] : "";
}
// POST /api/bons-cadeaux/statut {session_id, session_token?}
// La session Stripe (cs_…) n'est connue que de l'acheteur (URL de retour) : elle suffit à afficher le code.
// Si l'acheteur est connecté, le bon est rattaché à son compte (acheteur_luxyra_id).
async function handleBonCadeauStatut(request, env) {
  try {
    const b = await readJsonBody(request);
    const sid = String(b.session_id || "");
    if (!/^cs_(test|live)_[A-Za-z0-9]{10,}$/.test(sid)) return jsonResponse({ error: "Session invalide" }, 400);
    const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/cartes_cadeaux?select=id,code,valeur,payment_status,buyer_email,acheteur_luxyra_id,date_expiration&stripe_session_id=eq.${encodeURIComponent(sid)}&limit=1`, { headers: _sbHeaders(env) });
    const a = r.ok ? await r.json() : [];
    const bc = Array.isArray(a) ? a[0] : null;
    if (!bc) return jsonResponse({ ok: true, paye: false });
    if (bc.payment_status !== "paid") return jsonResponse({ ok: true, paye: false });
    if (b.session_token && !bc.acheteur_luxyra_id) {
      try {
        const sess = await verifyClientSession(b.session_token, env);
        if (sess && sess.lx_id) await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/cartes_cadeaux?id=eq.${encodeURIComponent(bc.id)}&acheteur_luxyra_id=is.null`, { method: "PATCH", headers: _sbHeaders(env, { Prefer: "return=minimal" }), body: JSON.stringify({ acheteur_luxyra_id: sess.lx_id }) });
      } catch (_) {}
    }
    return jsonResponse({ ok: true, paye: true, code: bc.code, valeur: Number(bc.valeur) || 0, date_expiration: bc.date_expiration || null, email: lxMasquerEmail(bc.buyer_email) });
  } catch (e) { return jsonResponse({ error: "Erreur serveur" }, 500); }
}
// POST /api/client/bons-cadeaux {session_token}
// Bons rattachés au compte (acheteur_luxyra_id), plus ceux achetés avec l'e-mail du compte SEULEMENT
// si cet e-mail est vérifié (clients_luxyra.email_verified) : sans vérification, n'importe qui pourrait
// créer un compte avec l'e-mail d'un autre et voir ses codes.
async function handleClientBonsCadeaux(request, env) {
  try {
    const { session_token } = await readJsonBody(request);
    const session = await verifyClientSession(session_token, env);
    if (!session) return jsonResponse({ error: "Session invalide" }, 401);
    let verifie = false;
    try {
      const v = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/clients_luxyra?select=email_verified&id=eq.${encodeURIComponent(session.lx_id)}&limit=1`, { headers: _sbHeaders(env) });
      const va = v.ok ? await v.json() : [];
      verifie = !!(Array.isArray(va) && va[0] && va[0].email_verified === true);
    } catch (_) {}
    const filtre = verifie && session.email
      ? `or=(acheteur_luxyra_id.eq.${encodeURIComponent(session.lx_id)},buyer_email.ilike.${encodeURIComponent(session.email.replace(/[*,()]/g, "").replace(/([\\%_])/g, "\\$1"))})`
      : `acheteur_luxyra_id=eq.${encodeURIComponent(session.lx_id)}`;
    const q = `${CONFIG.SUPABASE_URL}/rest/v1/cartes_cadeaux?select=id,salon_id,code,valeur,restant,utilise,de,pour,message,date_expiration,created_at,visuel_url,status,salons(nom,adresse,cp,ville,tel,logo,slug)&${filtre}&payment_status=eq.paid&order=created_at.desc&limit=100`;
    const r = await fetch(q, { headers: _sbHeaders(env) });
    const rows = r.ok ? await r.json() : [];
    return jsonResponse({ bons: Array.isArray(rows) ? rows : [], email_verifie: verifie });
  } catch (e) { return jsonResponse({ error: "Erreur serveur" }, 500); }
}
// POST /api/client/avis {session_token}
// Tous les avis du client, y compris signalés / masqués / non approuvés (l'anon ne voit que les publiés :
// un avis masqué réapparaissait en « Laisser un avis »).
async function handleClientAvis(request, env) {
  try {
    const { session_token } = await readJsonBody(request);
    const session = await verifyClientSession(session_token, env);
    if (!session) return jsonResponse({ error: "Session invalide" }, 401);
    const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/avis_salon?select=id,salon_id,rdv_online_id,ticket_id,note,texte,created_at,updated_at,note_accueil,note_proprete,note_cadre,note_qualite,photos,approved,reported,hidden_by_luxyra&client_luxyra_id=eq.${encodeURIComponent(session.lx_id)}&limit=500`, { headers: _sbHeaders(env) });
    const rows = r.ok ? await r.json() : [];
    return jsonResponse({ avis: (Array.isArray(rows) ? rows : []).map((x) => Object.assign({}, x, { en_moderation: x.approved !== true || x.reported === true || x.hidden_by_luxyra === true })) });
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
// Reçoit les évènements des comptes Stripe des salons (paiements directs des clients).
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
        // 2026-10-09 : filet si le client ferme la page avant le retour du paiement. On rejoue EXACTEMENT la
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
          // 2026-10-14 audit : 202 = confirmation en cours ailleurs -> Stripe rejouera (filet si l'autre appel échoue)
          if (st === 202) return jsonResponse({ error: "en cours" }, 409);
          if (st >= 400 && !/d[ée]j[àa]|already/i.test(txt)) await reportWorkerError(env, "worker:stripe-webhook-connect", new Error(`finalisation refusée ${t || md.subtype} ${st}`), { session: data.id, compte, reponse: txt.slice(0, 300) }, "warning");
        }
      }
    } else if (event.type === "charge.dispute.created") {
      const sr = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/salons?select=nom&stripe_connect_id=eq.${encodeURIComponent(compte)}&limit=1`, { headers: _sbHeaders(env) });
      const sa = sr.ok ? await sr.json() : [];
      const ech = data.evidence_details?.due_by ? new Date(data.evidence_details.due_by * 1000).toLocaleDateString("fr-FR") : "?";
      await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/notify_admins`, { method: "POST", headers: _sbHeaders(env), body: JSON.stringify({ p_event_type: "payment_failed", p_title: "⚠️ Litige chez un salon", p_body: `${(sa[0] && sa[0].nom) || compte} : ${(data.amount || 0) / 100} € — motif ${data.reason} — réponse avant le ${ech} (dans son Stripe)`, p_url: "/admin.html?tab=finance&sub=stripe", p_payload: {} }) });
    } else if (event.type === "account.updated") {
      const statut = lxConnectStatut(data); // 2026-10-14 audit : helper commun
      await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/salons?stripe_connect_id=eq.${encodeURIComponent(compte)}`, { method: "PATCH", headers: _sbHeaders(env, { Prefer: "return=minimal" }), body: JSON.stringify({ stripe_connect_status: statut }) });
    }
  } catch (e) {
    try { await reportWorkerError(env, "worker:stripe-webhook-connect", e, { type: event.type, account: compte }, "error"); } catch (_) {}
    return jsonResponse({ error: "processing" }, 500);  // Stripe réessaiera
  }
  return jsonResponse({ received: true });
}

// ============================================================
// BREVO — CRÉDITS DU COMPTE (2026-10-15) — GET /api/admin/brevo[?refresh=1]
// Réservé à l'admin (support@luxyra.fr + aal2, comme /api/admin/stripe). Lecture seule de
// GET https://api.brevo.com/v3/account. On ne renvoie QUE l'identité du compte et les plans/crédits
// (jamais relay, clé Marketing Automation, ids internes). Cache 5 min (mémoire + caches.default).
// ============================================================
const LX_BREVO_CACHE_TTL = 300000;
const LX_BREVO_CACHE_KEY = "https://luxyra.fr/__lx_cache/admin-brevo-account";
let _lxBrevoCache = null; // { at: ms, data: {...} }
function lxBrevoNettoyer(ja) {
  const num = (v) => (v == null || v === "" || !isFinite(Number(v)) ? null : Number(v));
  const plans = (Array.isArray(ja && ja.plan) ? ja.plan : []).map((p) => ({
    type: String(p.type || ""), credits: num(p.credits), creditsType: p.creditsType != null ? String(p.creditsType) : null,
    startDate: p.startDate || null, endDate: p.endDate || null
  }));
  const verticals = (Array.isArray(ja && ja.planVerticals) ? ja.planVerticals : []).map((v) => ({
    planCategory: v.planCategory || null, planType: v.planType || null, name: v.name || null, status: v.status || null, credits: num(v.credits), endDate: v.endDate || null
  }));
  const sms = plans.filter((p) => p.type.toLowerCase() === "sms");
  return {
    account: { email: ja && ja.email || null, companyName: ja && ja.companyName || null, firstName: ja && ja.firstName || null, lastName: ja && ja.lastName || null },
    plans, planVerticals: verticals,
    smsCredits: sms.length ? sms.reduce((t, p) => t + (p.credits || 0), 0) : null,
    emailPlans: plans.filter((p) => p.type.toLowerCase() !== "sms")
  };
}
async function handleAdminBrevo(request, env, url) {
  try {
    const u = await lxAuthUser(request);
    if (!u || !lxIsAdminUser(u)) return jsonResponse({ error: "Accès réservé à l'administrateur" }, 403);
    if (!env.BREVO_API_KEY) return jsonResponse({ error: "Clé API Brevo absente du worker (variable BREVO_API_KEY)" }, 503);
    const now = Date.now();
    // « Actualiser » contourne le cache, mais pas plus d'un appel Brevo toutes les 30 s
    const forcer = url.searchParams.get("refresh") === "1";
    const sortie = (c, cached) => jsonResponse(Object.assign({ ok: true }, c.data, { fetchedAt: new Date(c.at).toISOString(), cached, ageSec: Math.round((now - c.at) / 1000) }));
    if (!_lxBrevoCache) {
      try {
        const hit = await caches.default.match(LX_BREVO_CACHE_KEY);
        if (hit) { const j = await hit.json(); if (j && j.at && j.data) _lxBrevoCache = j; }
      } catch (_) {}
    }
    if (_lxBrevoCache && (now - _lxBrevoCache.at) < (forcer ? 30000 : LX_BREVO_CACHE_TTL)) return sortie(_lxBrevoCache, true);
    let r;
    try {
      r = await fetch("https://api.brevo.com/v3/account", { headers: { "api-key": env.BREVO_API_KEY, Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
    } catch (e) {
      if (_lxBrevoCache) return jsonResponse(Object.assign({ ok: true, stale: true, warning: "Brevo injoignable, dernières valeurs connues" }, _lxBrevoCache.data, { fetchedAt: new Date(_lxBrevoCache.at).toISOString(), cached: true, ageSec: Math.round((now - _lxBrevoCache.at) / 1000) }));
      return jsonResponse({ error: "Brevo injoignable (délai dépassé ou réseau)" }, 504);
    }
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      let msg = ""; try { msg = String(JSON.parse(txt).message || ""); } catch (_) { msg = txt; }
      msg = msg.slice(0, 200);
      if (r.status === 401 || r.status === 403) return jsonResponse({ error: "Clé API Brevo refusée par Brevo (" + r.status + ")" + (msg ? " : " + msg : ""), brevoStatus: r.status }, 502);
      if (r.status === 429) return jsonResponse({ error: "Brevo limite le nombre d'appels, réessayer dans une minute", brevoStatus: 429 }, 503);
      return jsonResponse({ error: "Erreur Brevo " + r.status + (msg ? " : " + msg : ""), brevoStatus: r.status }, 502);
    }
    const ja = await r.json().catch(() => null);
    if (!ja || typeof ja !== "object") return jsonResponse({ error: "Réponse Brevo illisible" }, 502);
    _lxBrevoCache = { at: now, data: lxBrevoNettoyer(ja) };
    try {
      await caches.default.put(LX_BREVO_CACHE_KEY, new Response(JSON.stringify(_lxBrevoCache), { headers: { "Content-Type": "application/json", "Cache-Control": "max-age=300" } }));
    } catch (_) {}
    return sortie(_lxBrevoCache, false);
  } catch (e) {
    try { await reportWorkerError(env, "worker:admin-brevo", e, {}, "warning"); } catch (_) {}
    return jsonResponse({ error: "Erreur interne : " + String(e && e.message || e).slice(0, 200) }, 500);
  }
}

// ============================================================
// BREVO — STATISTIQUES E-MAILS (2026-10-15) — GET /api/admin/brevo-emails[?refresh=1]
// Admin seulement (support@luxyra.fr + aal2). Lecture seule, même clé que les crédits (BREVO_API_KEY).
// Brevo GET /v3/smtp/statistics/aggregatedReport?days=7|30 (envoyés, délivrés, ouvertures, rejets, bloqués…)
// + 30 derniers incidents (rejets, bloqués, spam, invalides) des 7 derniers jours. Cache 10 min.
// ============================================================
const LX_BREVO_STATS_TTL = 600000;
const LX_BREVO_STATS_KEY = "https://luxyra.fr/__lx_cache/admin-brevo-emails";
let _lxBrevoStatsCache = null;
function lxBrevoAgreger(j) {
  const n = (v) => (v == null || !isFinite(Number(v)) ? 0 : Number(v));
  return {
    envoyes: n(j && j.requests), delivres: n(j && j.delivered), ouvertures: n(j && j.opens), ouvertures_uniques: n(j && j.uniqueOpens),
    clics: n(j && j.clicks), clics_uniques: n(j && j.uniqueClicks), rejets_definitifs: n(j && j.hardBounces), rejets_temporaires: n(j && j.softBounces),
    bloques: n(j && j.blocked), invalides: n(j && j.invalid), spam: n(j && j.spamReports), desabonnes: n(j && j.unsubscribed),
    periode: (j && j.range) || null
  };
}
async function handleAdminBrevoEmails(request, env, url) {
  try {
    const u = await lxAuthUser(request);
    if (!u || !lxIsAdminUser(u)) return jsonResponse({ error: "Accès réservé à l'administrateur" }, 403);
    if (!env.BREVO_API_KEY) return jsonResponse({ error: "Clé API Brevo absente du worker (variable BREVO_API_KEY)" }, 503);
    const now = Date.now();
    const forcer = url.searchParams.get("refresh") === "1";
    if (!_lxBrevoStatsCache) {
      try { const hit = await caches.default.match(LX_BREVO_STATS_KEY); if (hit) { const j = await hit.json(); if (j && j.at && j.data) _lxBrevoStatsCache = j; } } catch (_) {}
    }
    if (_lxBrevoStatsCache && (now - _lxBrevoStatsCache.at) < (forcer ? 30000 : LX_BREVO_STATS_TTL)) {
      return jsonResponse(Object.assign({ ok: true, cached: true, ageSec: Math.round((now - _lxBrevoStatsCache.at) / 1000) }, _lxBrevoStatsCache.data));
    }
    const h = { "api-key": env.BREVO_API_KEY, Accept: "application/json" };
    const appel = async (chemin) => {
      const r = await fetch("https://api.brevo.com/v3/" + chemin, { headers: h, signal: AbortSignal.timeout(10000) });
      if (!r.ok) { const t = await r.text().catch(() => ""); let m = ""; try { m = String(JSON.parse(t).message || ""); } catch (_) { m = t; } throw Object.assign(new Error("Brevo " + r.status + (m ? " : " + m.slice(0, 160) : "")), { status: r.status }); }
      return r.json();
    };
    let s7, s30, ev;
    try {
      [s7, s30, ev] = await Promise.all([
        appel("smtp/statistics/aggregatedReport?days=7"),
        appel("smtp/statistics/aggregatedReport?days=30"),
        appel("smtp/statistics/events?limit=100&days=7&sort=desc").catch(() => ({ events: [] }))
      ]);
    } catch (e) {
      if (_lxBrevoStatsCache) return jsonResponse(Object.assign({ ok: true, stale: true, warning: "Brevo injoignable, dernières valeurs connues" }, _lxBrevoStatsCache.data));
      const st = e && e.status;
      return jsonResponse({ error: (st === 401 || st === 403) ? "Clé API Brevo refusée (" + st + ")" : (st === 429 ? "Brevo limite le nombre d'appels, réessayer dans une minute" : String(e && e.message || e).slice(0, 200)) }, st === 429 ? 503 : 502);
    }
    const TYPES = { hardBounces: "Rejet définitif", softBounces: "Rejet temporaire", blocked: "Bloqué", spam: "Signalé comme spam", invalid: "Adresse invalide", error: "Erreur", deferred: "Différé" };
    const incidents = (Array.isArray(ev && ev.events) ? ev.events : [])
      .filter((x) => TYPES[x.event])
      .slice(0, 30)
      .map((x) => ({ date: x.date || null, type: TYPES[x.event], email: String(x.email || "").slice(0, 120), sujet: String(x.subject || "").slice(0, 160), raison: String(x.reason || "").slice(0, 200) }));
    const data = { j7: lxBrevoAgreger(s7), j30: lxBrevoAgreger(s30), incidents, fetchedAt: new Date(now).toISOString() };
    _lxBrevoStatsCache = { at: now, data };
    try { await caches.default.put(LX_BREVO_STATS_KEY, new Response(JSON.stringify(_lxBrevoStatsCache), { headers: { "Content-Type": "application/json", "Cache-Control": "max-age=600" } })); } catch (_) {}
    return jsonResponse(Object.assign({ ok: true, cached: false, ageSec: 0 }, data));
  } catch (e) {
    try { await reportWorkerError(env, "worker:admin-brevo-emails", e, {}, "warning"); } catch (_) {}
    return jsonResponse({ error: "Erreur interne : " + String(e && e.message || e).slice(0, 200) }, 500);
  }
}

// ============================================================
// GITHUB ACTIONS — SAUVEGARDE DE NUIT, TEST DE RESTAURATION, DÉPLOIEMENT DU WORKER (2026-10-15)
// GET /api/admin/github-actions[?refresh=1] — admin seulement. Jeton GitHub en LECTURE SEULE dans la variable
// secrète GITHUB_TOKEN_RO (jeton « fine-grained », dépôt Luxyra-fr/luxyra.fr, permission Actions : Read-only).
// Sans jeton : { connecte: false } (le panneau affiche la marche à suivre). Cache 5 min. Jamais d'écriture.
// ============================================================
const LX_GH_REPO = "Luxyra-fr/luxyra.fr";
const LX_GH_WORKFLOWS = [
  { fichier: "sauvegarde-nuit.yml", nom: "Sauvegarde de nuit", attendu_h: 26 },
  { fichier: "test-restauration.yml", nom: "Test de restauration (mensuel)", attendu_h: 24 * 32 },
  { fichier: "deploy-worker.yml", nom: "Déploiement du worker", attendu_h: null }
];
let _lxGhCache = null;
async function handleAdminGithubActions(request, env, url) {
  try {
    const u = await lxAuthUser(request);
    if (!u || !lxIsAdminUser(u)) return jsonResponse({ error: "Accès réservé à l'administrateur" }, 403);
    // 2026-10-17 : dépôt PUBLIC -> lecture des exécutions sans jeton (API publique GitHub) ; jeton facultatif (quota plus élevé).
    const now = Date.now();
    if (_lxGhCache && (now - _lxGhCache.at) < (url.searchParams.get("refresh") === "1" ? 30000 : (env.GITHUB_TOKEN_RO ? 300000 : 900000))) {
      return jsonResponse(Object.assign({ ok: true, connecte: true, cached: true, ageSec: Math.round((now - _lxGhCache.at) / 1000) }, _lxGhCache.data));
    }
    const h = { ...(env.GITHUB_TOKEN_RO ? { Authorization: "Bearer " + env.GITHUB_TOKEN_RO } : {}), Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "luxyra-admin" };
    const workflows = await Promise.all(LX_GH_WORKFLOWS.map(async (w) => {
      try {
        const r = await fetch(`https://api.github.com/repos/${LX_GH_REPO}/actions/workflows/${w.fichier}/runs?per_page=10`, { headers: h, signal: AbortSignal.timeout(10000) });
        if (r.status === 401 || r.status === 403) return { fichier: w.fichier, nom: w.nom, erreur: env.GITHUB_TOKEN_RO ? "Jeton refusé par GitHub (" + r.status + ") : vérifier ses droits (Actions : lecture) et sa date d'expiration" : "Quota de lecture GitHub atteint (" + r.status + ") : réessayez dans quelques minutes" };
        if (r.status === 404) return { fichier: w.fichier, nom: w.nom, erreur: "Automatisme introuvable (fichier renommé ?) ou jeton sans accès au dépôt" };
        if (!r.ok) return { fichier: w.fichier, nom: w.nom, erreur: "GitHub " + r.status };
        const j = await r.json();
        const runs = (j.workflow_runs || []).map((x) => ({ id: x.id, statut: x.status, conclusion: x.conclusion, debut: x.run_started_at || x.created_at, maj: x.updated_at, declencheur: x.event, lien: x.html_url, branche: x.head_branch }));
        const fini = runs.find((x) => x.statut === "completed") || null;
        const succes = runs.find((x) => x.statut === "completed" && x.conclusion === "success") || null;
        const enRetard = !!(w.attendu_h && (!fini || (now - new Date(fini.debut).getTime()) > w.attendu_h * 3600000));
        return { fichier: w.fichier, nom: w.nom, dernier: runs[0] || null, dernier_termine: fini, dernier_succes: succes,
          ok: !!(fini && fini.conclusion === "success") && !enRetard, en_retard: enRetard, executions: runs.slice(0, 5) };
      } catch (e) { return { fichier: w.fichier, nom: w.nom, erreur: "GitHub injoignable : " + String(e && e.message || e).slice(0, 120) }; }
    }));
    const data = { depot: LX_GH_REPO, workflows, fetchedAt: new Date(now).toISOString() };
    _lxGhCache = { at: now, data };
    return jsonResponse(Object.assign({ ok: true, connecte: true, cached: false, ageSec: 0 }, data));
  } catch (e) {
    try { await reportWorkerError(env, "worker:admin-github", e, {}, "warning"); } catch (_) {}
    return jsonResponse({ error: "Erreur interne : " + String(e && e.message || e).slice(0, 200) }, 500);
  }
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
      await saLog(env, "STRIPE_REMBOURSEMENT", salon.id, `${saEur(montant)} € sur ${pi.id} (${piCompte ? "paiement client sur le compte du salon" : estClient ? "paiement client (ancien mode), repris au salon" : "abonnement Luxyra"}) par ${admin} — ${motif}`);
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
    const ch = !!a.charges_enabled;
    const statut = lxConnectStatut(a); // 2026-10-14 audit : helper commun
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
  clients: ["Importer ou créer vos clients", "tuile Clients (ou Paramètres → Migration depuis votre ancien logiciel)"],
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
        <p>Astuce : vous pouvez importer vos clients et vos prestations depuis votre ancien logiciel (Paramètres → Migration).</p>`;
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
      corps = bonjour + `<p>Votre essai gratuit de Luxyra se termine <b>${fin}</b>. Pour continuer sans interruption et garder toutes vos données (clients, rendez-vous, caisse), choisissez votre forfait dans <b>Paramètres → S'abonner</b>.</p>
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
  // Non concernés : franchise de TVA (art. 293 B, taux 0) et établissements hors de France
  const sr = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/salons?select=id,nom,email,gerant_prenom,abonne_depuis,config_json&status=eq.active&taux_tva=gt.0`, { headers: _sbHeaders(env) });
  const salons = sr.ok ? await sr.json() : [];
  const ar = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/nf525_attestations?select=salon_id&version_majeure=eq.${encodeURIComponent(ed.version_majeure)}`, { headers: _sbHeaders(env) });
  const signes = new Set((ar.ok ? await ar.json() : []).map((x) => x.salon_id));
  const hier = Date.now() - 86400000;
  for (const s of salons) {
    if (!s.email || signes.has(s.id)) continue;
    try { let cj = s.config_json; if (typeof cj === "string") cj = JSON.parse(cj); if (cj && cj.pays && !/^\s*france\s*$/i.test(String(cj.pays))) continue; } catch (_) {}
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
    if (demande.status === "pending") return jsonResponse({ error: "L'établissement prépare une nouvelle proposition : vous allez la recevoir. Aucun paiement n'a été effectué." }, 409); // 2026-10-14
    if (["refused", "cancelled_by_salon", "expired"].includes(demande.status)) {
      return jsonResponse({ error: "Cette proposition n'est plus active." }, 409);
    }
    if (demande.proposal_expires_at && new Date(demande.proposal_expires_at) < new Date()) {
      return jsonResponse({ error: "Cette proposition a expiré." }, 410);
    }
    if (demande.status !== "proposed") return jsonResponse({ error: "État inattendu: " + demande.status }, 409);

    // 2026-10-15 : réservation en ligne désactivée par l'établissement -> personne ne peut réserver en ligne
    try {
      const scR = await fetch(`${sbUrl}/rest/v1/site_config?salon_id=eq.${demande.salon_id}&select=site_actif,reservation_active&limit=1`, { headers: _sbHeaders(env) });
      const scRows = scR.ok ? await scR.json() : [];
      const sc = Array.isArray(scRows) ? scRows[0] : null;
      if (sc && (sc.site_actif === false || sc.reservation_active !== true)) {
        return jsonResponse({ error: "Cet établissement n'accepte pas de réservation en ligne pour le moment. Aucun paiement n'a été effectué." }, 409);
      }
    } catch (_) { /* vérification indisponible : la base refusera de toute façon les nouvelles demandes */ }

    const pd = demande.proposed_data || {};
    const acompte = Number(pd.acompte_montant) || 0;
    if (acompte <= 0) return jsonResponse({ error: "Aucun acompte à régler." }, 400);
    // 2026-10-10 : le créneau proposé est-il toujours libre ? (une proposition ne bloque pas le planning)
    try {
      const cr = await fetch(`${sbUrl}/rest/v1/rpc/lx_creneau_libre`, { method: "POST", headers: _sbHeaders(env), body: JSON.stringify({ p_salon: demande.salon_id, p_collab: pd.collaborateur_id ? Number(pd.collaborateur_id) : null, p_date: pd.date, p_heure: pd.heure, p_duree: Number(pd.duree_minutes) || 30 }) });
      if (cr.ok && (await cr.json()) === false) {
        await fetch(`${sbUrl}/rest/v1/rdv_demandes?id=eq.${demande.id}`, { method: "PATCH", headers: _sbHeaders(env, { Prefer: "return=minimal" }), body: JSON.stringify({ refuse_reason: "Créneau pris entre-temps (vérifié avant paiement)" }) });
        return jsonResponse({ error: "Ce créneau vient d'être pris entre-temps. Le salon a été prévenu et va vous proposer un autre horaire. Aucun paiement n'a été effectué.", creneau_pris: true }, 409);
      }
    } catch (_) { /* en cas d'erreur de vérification, on ne bloque pas */ }

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
    const session = await stripeAPI(env, "checkout/sessions", lxBrandingSalon({
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
    }, salon), "POST", (await lxChargesDirectes(env)) ? salon.stripe_connect_id : null);

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
      // 2026-10-14 audit : une AUTRE session payée pour une proposition déjà confirmée = double paiement
      if (demande.stripe_session_id && demande.stripe_session_id !== session.id) {
        try { await reportWorkerError(env, "worker:rdv-demande-finalize", new Error("Double paiement d'une proposition sur mesure (a rembourser)"), { demande_id: demande.id, session_confirmee: demande.stripe_session_id, session_en_trop: session.id, payment_intent: session.payment_intent || null }, "critical"); } catch (_) {}
      }
      return jsonResponse({ ok: true, already_confirmed: true, rdv_online_id: demande.rdv_online_id });
    }

    // 2026-10-14 audit : prise ATOMIQUE de la demande avant toute insertion (le retour navigateur et le
    // webhook Stripe arrivent souvent en même temps -> avant : deux rdv_online pour une proposition).
    const _staleIso = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const _claimAt = new Date().toISOString();
    const _claimRes = await fetch(`${sbUrl}/rest/v1/rdv_demandes?id=eq.${demande.id}&status=eq.proposed&or=(confirm_claim_at.is.null,confirm_claim_at.lt.${encodeURIComponent(_staleIso)})`, {
      method: "PATCH",
      headers: { ..._sbHeaders(env), "Prefer": "return=representation" },
      body: JSON.stringify({ confirm_claim_at: _claimAt, stripe_session_id: session.id })
    });
    const _claim = _claimRes.ok ? await _claimRes.json().catch(() => []) : [];
    if (!Array.isArray(_claim) || !_claim[0]) {
      const _re = await fetch(`${sbUrl}/rest/v1/rdv_demandes?id=eq.${demande.id}&select=status,rdv_online_id,stripe_session_id&limit=1`, { headers: _sbHeaders(env) });
      const _ra = _re.ok ? await _re.json() : [];
      const _d = (Array.isArray(_ra) && _ra[0]) || {};
      if (_d.status === "confirmed" && _d.rdv_online_id) {
        if (_d.stripe_session_id && _d.stripe_session_id !== session.id) {
          try { await reportWorkerError(env, "worker:rdv-demande-finalize", new Error("Double paiement d'une proposition sur mesure (a rembourser)"), { demande_id: demande.id, session_confirmee: _d.stripe_session_id, session_en_trop: session.id }, "critical"); } catch (_) {}
        }
        return jsonResponse({ ok: true, already_confirmed: true, rdv_online_id: _d.rdv_online_id });
      }
      if (_d.status === "proposed") return jsonResponse({ ok: true, en_cours: true }, 202);
      try { await reportWorkerError(env, "worker:rdv-demande-finalize", new Error("Acompte paye pour une proposition qui n'est plus active (a rembourser)"), { demande_id: demande.id, status: _d.status, session: session.id }, "critical"); } catch (_) {}
      return jsonResponse({ error: "Cette proposition n'est plus active. Votre paiement sera remboursé par l'établissement." }, 409);
    }
    const _libererClaim = async () => { try { await fetch(`${sbUrl}/rest/v1/rdv_demandes?id=eq.${demande.id}&status=eq.proposed`, { method: "PATCH", headers: { ..._sbHeaders(env), "Prefer": "return=minimal" }, body: JSON.stringify({ confirm_claim_at: null }) }); } catch (_) {} };

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

    // 2026-10-14 audit : RDV déjà créé pour CE paiement (essai précédent interrompu avant la mise à jour
    // de la demande) -> on le réutilise au lieu d'en insérer un second. Lien = payment_intent_id
    // (index unique rdv_online_payment_intent_unique ; rdv_online n'a pas de colonne demande_id).
    const _rdvDuPaiement = async () => {
      if (!session.payment_intent) return null;
      const _ex = await fetch(`${sbUrl}/rest/v1/rdv_online?payment_intent_id=eq.${encodeURIComponent(session.payment_intent)}&salon_id=eq.${demande.salon_id}&select=id,status,acompte_paye&limit=1`, { headers: _sbHeaders(env) });
      if (!_ex.ok) throw new Error("Lecture rdv_online existant impossible (HTTP " + _ex.status + ")");
      const _exa = await _ex.json();
      return (Array.isArray(_exa) && _exa[0]) || null;
    };
    let rdvOnlineId = null;
    let _existant = null;
    try { _existant = await _rdvDuPaiement(); }
    catch (eEx) {
      await _libererClaim();
      return jsonResponse({ error: "Confirmation momentanément impossible, réessai automatique.", paiement_recu: true }, 503);
    }
    if (_existant) {
      rdvOnlineId = _existant.id;
    } else {
      const insertRes = await fetch(`${sbUrl}/rest/v1/rdv_online`, {
        method: "POST",
        headers: { ..._sbHeaders(env), "Prefer": "return=representation" },
        body: JSON.stringify(rdvData)
      });
      const insertBody = await insertRes.json().catch(() => null);
      if (!insertRes.ok || !Array.isArray(insertBody) || !insertBody[0]) {
        // Conflit sur l'index unique du paiement = un autre chemin vient de créer le RDV -> on le reprend
        let _apres = null;
        try { _apres = await _rdvDuPaiement(); } catch (_) {}
        if (_apres) rdvOnlineId = _apres.id;
        else {
          console.error("rdv_online INSERT failed:", insertRes.status, JSON.stringify(insertBody));
          await _libererClaim(); // aucun RDV créé : le webhook / la page pourront réessayer
          return jsonResponse({ error: "Insert rdv_online échoué: " + JSON.stringify(insertBody), paiement_recu: true }, 500);
        }
      } else {
        rdvOnlineId = insertBody[0].id;
      }
    }

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
    // 2026-10-14 audit : conditionnel (toujours « proposed » ET toujours NOTRE verrou) et résultat vérifié.
    // Échec -> verrou CONSERVÉ (aucun autre chemin ne peut insérer pendant 3 min) + 5xx : Stripe réessaie le
    // webhook ; une fois le verrou expiré, le réessai reprend le RDV ci-dessus (même payment_intent).
    const demUpdRes = await fetch(`${sbUrl}/rest/v1/rdv_demandes?id=eq.${demande.id}&status=eq.proposed&confirm_claim_at=eq.${encodeURIComponent(_claimAt)}`, {
      method: "PATCH",
      headers: { ..._sbHeaders(env), "Prefer": "return=representation" },
      body: JSON.stringify({
        status: "confirmed",
        confirmed_at: new Date().toISOString(),
        rdv_online_id: rdvOnlineId
      })
    });
    const demUpdRows = demUpdRes.ok ? await demUpdRes.json().catch(() => null) : null;
    if (!Array.isArray(demUpdRows) || !demUpdRows[0]) {
      const _errTxt = demUpdRes.ok ? "0 ligne mise à jour" : await demUpdRes.text().catch(() => "HTTP " + demUpdRes.status);
      // Un autre chemin a pu confirmer entre-temps avec CE même RDV -> succès
      try {
        const _re2 = await fetch(`${sbUrl}/rest/v1/rdv_demandes?id=eq.${demande.id}&select=status,rdv_online_id&limit=1`, { headers: _sbHeaders(env) });
        const _r2 = _re2.ok ? await _re2.json() : [];
        if (Array.isArray(_r2) && _r2[0] && _r2[0].status === "confirmed" && _r2[0].rdv_online_id === rdvOnlineId) {
          return jsonResponse({ ok: true, already_confirmed: true, rdv_online_id: rdvOnlineId });
        }
      } catch (_) {}
      console.error("rdv_demandes UPDATE confirmed failed:", _errTxt);
      try { await reportWorkerError(env, "worker:rdv-demande-finalize", new Error("Demande sur mesure non passée en confirmée après création du RDV (réessai Stripe)"), { demande_id: demande.id, rdv_online_id: rdvOnlineId, session: session.id, detail: String(_errTxt).slice(0, 300) }, "error"); } catch (_) {}
      return jsonResponse({ error: "Paiement reçu, confirmation en cours de finalisation.", paiement_recu: true, en_cours: true }, 503);
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
// Les paiements des clients sont créés SUR le compte Stripe du salon : frais Stripe, litiges et
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
// Paramètres Checkout d'un paiement de client : direct (sur le compte du salon) ou ancien mode destination.
function lxParamsPaiementSalon(params, direct, connectId) {
  if (!direct) params["payment_intent_data[transfer_data][destination]"] = connectId;
  return params;
}

// 2026-10-13 : page de paiement d'un salon aux couleurs Luxyra, avec le nom et le logo du salon (logo Luxyra sinon)
function lxBrandingSalon(params, salon) {
  if (!params || !salon) return params;
  const logoOk = typeof salon.logo === "string" && (/^data:image\/(png|jpe?g|webp);base64,/.test(salon.logo) || /^https:\/\//.test(salon.logo));
  params["branding_settings[display_name]"] = String(salon.nom || "Luxyra").slice(0, 100);
  params["branding_settings[logo][type]"] = "url";
  params["branding_settings[logo][url]"] = logoOk ? `https://luxyra.fr/api/salon-logo/${salon.id}.png?v=${String(salon.logo).length}` : "https://luxyra.fr/luxyra-logo.png";
  params["branding_settings[button_color]"] = "#c8a84e";
  params["branding_settings[background_color]"] = "#0b0b0b";
  params["branding_settings[border_style]"] = "rounded";
  params["branding_settings[font_family]"] = "inter";
  return params;
}
async function handleSalonLogo(id, env) {
  try {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.redirect("https://luxyra.fr/luxyra-logo.png", 302);
    const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/salons_public?id=eq.${id}&select=logo`, { headers: _sbHeaders(env) });
    const d = r.ok ? await r.json() : [];
    const logo = d && d[0] ? String(d[0].logo || "") : "";
    const m = logo.match(/^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/);
    if (m) {
      const bin = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
      return new Response(bin, { headers: { "Content-Type": m[1], "Cache-Control": "public, max-age=86400" } });
    }
    if (/^https:\/\//.test(logo)) return Response.redirect(logo, 302);
  } catch (_) {}
  return Response.redirect("https://luxyra.fr/luxyra-logo.png", 302);
}

async function stripeAPI(env, endpoint, params, method = "POST", compte = null, idemKey = null) {
  const options = { method, headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } };
  // 2026-10-09 : appel « au nom » du compte Stripe d'un salon (charges directes)
  if (compte) options.headers["Stripe-Account"] = String(compte);
  // 2026-10-14 audit : clé d'idempotence Stripe (un même remboursement rejoué = le même objet, jamais deux)
  if (idemKey && method === "POST") options.headers["Idempotency-Key"] = String(idemKey).slice(0, 255);
  if (params && method === "POST") {
    options.headers["Content-Type"] = "application/x-www-form-urlencoded";
    options.body = new URLSearchParams(params).toString();
  }
  const _resp = await fetch(`https://api.stripe.com/v1/${endpoint}`, options);
  const _txt = await _resp.text();
  if (!_txt) return { error: { type: "upstream_non_json", message: "Réponse Stripe vide (HTTP " + _resp.status + ")", http_status: _resp.status, raw: "" } };
  let _res;
  try { _res = JSON.parse(_txt); }
  catch (_e) { return { error: { type: "upstream_non_json", message: "Réponse Stripe non-JSON (HTTP " + _resp.status + ")", http_status: _resp.status, raw: String(_txt).slice(0, 200) } }; }
  // 2026-10-13 : si Stripe refuse l'habillage (logo illisible…), on réessaie SANS habillage : un paiement ne doit jamais échouer pour une question de design
  if (_res && _res.error && params && method === "POST" && Object.keys(params).some((k) => k.startsWith("branding_settings["))) {
    const p2 = {}; Object.keys(params).forEach((k) => { if (!k.startsWith("branding_settings[")) p2[k] = params[k]; });
    console.warn("branding refusé, nouvel essai sans habillage:", _res.error.message);
    return await stripeAPI(env, endpoint, p2, method, compte);
  }
  return _res;
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

// 2026-10-17 audit réglages (#1) : site vitrine / réservation en ligne et changement de forfait.
// Coupure (passage en Essentiel, résiliation) : l'état choisi par le pro est mémorisé dans site_config.coupe_par_forfait
// (une seule fois : une 2e coupure n'écrase pas la mémoire), puis site et réservation sont coupés.
async function lxSiteCouperForfait(env, salonId) {
  let sc = null;
  try {
    const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/site_config?salon_id=eq.${encodeURIComponent(salonId)}&select=site_actif,reservation_active,coupe_par_forfait&limit=1`, { headers: _sbHeaders(env) });
    const a = r.ok ? await r.json() : []; sc = Array.isArray(a) ? a[0] || null : null;
  } catch (_) { sc = null; }
  const champs = { site_actif: false, reservation_active: false };
  if (sc && !(sc.coupe_par_forfait && typeof sc.coupe_par_forfait === "object") && (sc.site_actif === true || sc.reservation_active === true)) {
    champs.coupe_par_forfait = { site_actif: sc.site_actif === true, reservation_active: sc.reservation_active === true, le: new Date().toISOString() };
  }
  await patchSiteConfig(env, salonId, champs);
}
// Passage en Pro : rien si le salon était déjà Pro (renouvellement, prix Fondateur...). Sinon : état d'avant la coupure
// s'il est connu (et que le pro n'a rien changé depuis), sinon première activation seulement si tout est coupé.
async function lxSiteApresPassagePro(env, salonId, ancienPlan) {
  if (ancienPlan === "pro") return;
  let sc = null;
  try {
    const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/site_config?salon_id=eq.${encodeURIComponent(salonId)}&select=site_actif,reservation_active,coupe_par_forfait&limit=1`, { headers: _sbHeaders(env) });
    const a = r.ok ? await r.json() : []; sc = Array.isArray(a) ? a[0] || null : null;
  } catch (_) { sc = null; }
  if (!sc) return;
  const m = sc.coupe_par_forfait;
  if (m && typeof m === "object") {
    await patchSiteConfig(env, salonId, { site_actif: m.site_actif === true, reservation_active: m.reservation_active === true, coupe_par_forfait: null });
  } else if (sc.site_actif !== true && sc.reservation_active !== true) {
    await patchSiteConfig(env, salonId, { site_actif: true, reservation_active: true });
  }
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
async function brevoSendEmail(env, { to, toName, senderEmail, senderName, subject, htmlContent, textContent, replyTo, attachment, headers }) {
  const payload = {
    sender: { name: senderName || "Luxyra", email: senderEmail || "contact@luxyra.fr" },
    to: [{ email: to, name: toName || "" }], subject,
    htmlContent: htmlContent || "<p>" + (textContent || subject) + "</p>",
    textContent: textContent || subject || "Message de Luxyra",
  };
  if (replyTo) payload.replyTo = { email: replyTo };
  if (attachment) payload.attachment = attachment;
  if (headers && typeof headers === "object") payload.headers = headers;  // 2026-10-17 audit réglages (#4) : List-Unsubscribe
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

// ============================================================
// 2026-10-17 SMS PUBLICITAIRES (campagnes, anniversaire, relance) — jamais les rappels / confirmations de RDV
//  - 2026-10-17 (décision du propriétaire) : PAS de mention Brevo « STOP au 36xxx ». Notre lien de désinscription
//    « \nStop SMS: luxyra.fr/s/<code> » (29 caractères, LX_SMS_MENTION_LONGUEUR) est ajouté à chaque SMS publicitaire :
//    par la file SQL (traiter_sms_differes) ou, pour un envoi depuis l'appareil avec contexte, par handleSmsCustom ;
//  - créneau : lundi au samedi, 8 h - 21 h 30 (Paris), jamais le dimanche ni un jour férié français
//    (21 h 30 = limite Brevo pour la France : au-delà, Brevo retient le SMS jusqu'au lendemain 8 h, même un dimanche) ;
//  - numéro ayant répondu STOP (table lx_sms_stop) : refusé, sans débit.
// Même règle en SQL : lx_prive.sms_pub_creneau_ok / lx_prive.est_jour_ferie_fr (docs/migrations_1017/sms_stop_creneaux.sql).
// ============================================================
const LX_SMS_PUB_CONTEXTES = new Set(["marketing", "anniversaire", "relance"]);
// 2026-10-17 lien court : mention de désinscription des SMS publicitaires (le code fait toujours 6 caractères)
const LX_SMS_MENTION_PREFIXE = "\nStop SMS: luxyra.fr/s/";
const LX_SMS_MENTION_LONGUEUR = LX_SMS_MENTION_PREFIXE.length + 6; // = 29 (saut de ligne compris)
function lxPaques(an) {
  const a = an % 19, b = Math.floor(an / 100), c = an % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31), jour = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(an, mois - 1, jour);
}
// an, mois (1-12), jour -> jour férié légal (1er janv, lundi de Pâques, 1er mai, 8 mai, Ascension, lundi de Pentecôte,
// 14 juillet, 15 août, 1er nov, 11 nov, 25 déc)
function lxJourFerieFr(an, mois, jour) {
  const md = String(mois).padStart(2, "0") + "-" + String(jour).padStart(2, "0");
  if (["01-01", "05-01", "05-08", "07-14", "08-15", "11-01", "11-11", "12-25"].indexOf(md) >= 0) return true;
  const ecart = Math.round((Date.UTC(an, mois - 1, jour) - lxPaques(an)) / 86400000);
  return ecart === 1 || ecart === 39 || ecart === 50;
}
function lxSmsPubCreneauOk(date) {
  try {
    const p = {};
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(date || new Date()).forEach((x) => { p[x.type] = x.value; });
    const an = Number(p.year), mois = Number(p.month), jour = Number(p.day), mn = Number(p.hour) * 60 + Number(p.minute);
    const dow = new Date(Date.UTC(an, mois - 1, jour)).getUTCDay(); // 0 = dimanche
    if (dow === 0 || lxJourFerieFr(an, mois, jour)) return false;
    return mn >= 8 * 60 && mn < 21 * 60 + 30;
  } catch (_) { return false; }
}
async function lxSmsPubBloque(env, tel) {
  try {
    const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/lx_sms_pub_bloque`, { method: "POST", headers: _sbHeaders(env), body: JSON.stringify({ p_tel: String(tel || "") }) });
    // 2026-10-17 soir : le blocage Brevo étant levé après un STOP (pour garder les rappels), lx_sms_stop est
    // désormais NOTRE SEULE protection : base injoignable -> SMS publicitaire REFUSÉ (jamais d'envoi « à l'aveugle »).
    if (!r.ok) return true;
    return (await r.json()) === true;
  } catch (_) { return true; }
}
// ============================================================
// 2026-10-17 soir — STOP : l'opposition reste chez NOUS, les rappels de RDV continuent
// Constat réel : après un STOP, Brevo met le numéro dans la blocklist « SMS transactionnels » du compte UNIQUE
// Luxyra (help.brevo.com 209458705 : un contact qui se désinscrit en répondant à vos SMS transactionnels ne reçoit
// plus AUCUN SMS transactionnel) -> le rappel suivant (message 6058006860145686) a reçu l'accusé « bl »
// (Blacklisted) et n'est jamais parti. Un STOP sur une promo d'un salon couperait les rappels de tous les salons.
// Règle Luxyra :
//  - le STOP vise la prospection : le numéro reste dans lx_sms_stop, tout SMS publicitaire (campagne, anniversaire,
//    relance) vers lui est refusé, de tous les salons (lxSmsPubBloque, refus si la base ne répond pas) ;
//  - les SMS transactionnels (rappel, confirmation, modification, annulation) ne sont pas de la prospection : on lève
//    le blocage Brevo (PUT /v3/contacts/{SMS}?identifierType=phone_id {"smsBlacklisted":false}, seul déblocage SMS
//    documenté par Brevo) ; si Brevo bloque malgré tout un rappel (« bl »), remboursement + alerte admin avec la
//    marche à suivre (Brevo > Paramètres > SMS transactionnels > Contacts bloqués : aucune API documentée) ;
//  - solution de fond : BREVO_API_KEY_MARKETING (compte / sous-compte Brevo dédié aux SMS publicitaires) -> les STOP
//    ne touchent plus le compte des rappels (brevoSendSms choisit la clé selon le type).
// Le STOP Brevo reste donc respecté pour ce qu'il vise : aucun SMS publicitaire n'est plus jamais envoyé à ce numéro
// tant qu'il ne répond pas START (ou ne demande pas sa réinscription au support).
// ============================================================
function lxBrevoClesSms(env) {
  const l = [];
  if (env.BREVO_API_KEY) l.push({ cle: env.BREVO_API_KEY, compte: "principal" });
  if (env.BREVO_API_KEY_MARKETING && env.BREVO_API_KEY_MARKETING !== env.BREVO_API_KEY) l.push({ cle: env.BREVO_API_KEY_MARKETING, compte: "marketing" });
  return l;
}
// Numéro au format international attendu par Brevo (+33XXXXXXXXX pour la France)
function lxTelInternational(tel) {
  const d = String(tel || "").replace(/\D/g, "");
  if (/^0[1-9]\d{8}$/.test(d)) return "+33" + d.slice(1);
  if (/^0033\d{9}$/.test(d)) return "+" + d.slice(2);
  if (/^00\d{8,}$/.test(d)) return "+" + d.slice(2);
  return d.length >= 8 ? "+" + d : null;
}
// Même règle que public.normalize_phone (clé de lx_sms_stop)
function lxTelNorm(tel) {
  let v = String(tel || "").replace(/\D/g, "");
  if (v.length === 11 && /^33/.test(v)) v = "0" + v.slice(2);
  if (v.length === 13 && /^0033/.test(v)) v = "0" + v.slice(4);
  return v.length < 8 ? "" : v;
}
// Lève le blocage SMS du numéro sur le compte Brevo des rappels (clé principale). Ne touche PAS à lx_sms_stop.
// Résultat : { ok, etat: 'debloque' | 'deja_libre' | 'aucun_contact' | 'erreur', detail }
async function lxBrevoSmsDebloquer(env, tel) {
  const intl = lxTelInternational(tel);
  if (!intl) return { ok: false, etat: "erreur", detail: "numéro invalide" };
  if (!env.BREVO_API_KEY) return { ok: false, etat: "erreur", detail: "BREVO_API_KEY absente" };
  const h = { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json", Accept: "application/json" };
  const url = `https://api.brevo.com/v3/contacts/${encodeURIComponent(intl)}?identifierType=phone_id`;
  try {
    const rg = await fetch(url, { headers: h, signal: AbortSignal.timeout(10000) });
    if (rg.status === 404) {
      // Pas de fiche contact : le blocage ne peut être que dans « SMS transactionnels > Contacts bloqués » (sans API)
      return { ok: false, etat: "aucun_contact", detail: "aucune fiche contact Brevo pour ce numéro : vérifier Brevo > Paramètres > SMS transactionnels > Contacts bloqués" };
    }
    const jg = rg.ok ? await rg.json().catch(() => ({})) : null;
    if (!rg.ok) return { ok: false, etat: "erreur", detail: "lecture contact Brevo HTTP " + rg.status };
    if (jg && jg.smsBlacklisted === false) return { ok: true, etat: "deja_libre", detail: "contact Brevo non blocklisté (smsBlacklisted=false)" };
    const rp = await fetch(url, { method: "PUT", headers: h, body: JSON.stringify({ smsBlacklisted: false }), signal: AbortSignal.timeout(10000) });
    if (rp.ok || rp.status === 204) return { ok: true, etat: "debloque", detail: "smsBlacklisted true -> false (contact " + (jg && jg.id) + ")" };
    const t = await rp.text().catch(() => "");
    return { ok: false, etat: "erreur", detail: "déblocage Brevo HTTP " + rp.status + (t ? " : " + t.slice(0, 120) : "") };
  } catch (e) {
    return { ok: false, etat: "erreur", detail: "Brevo injoignable : " + String(e && e.message || e).slice(0, 100) };
  }
}
// Débloque chez Brevo + trace (lx_sms_stop.brevo_*, audit_log des salons concernés, admin_log) + alerte si échec
async function lxBrevoSmsDebloquerTrace(env, tel, alerter) {
  const res = await lxBrevoSmsDebloquer(env, tel);
  try {
    await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/lx_sms_stop_brevo_resultat`, { method: "POST", headers: _sbHeaders(env),
      body: JSON.stringify({ p_tel: String(tel || ""), p_ok: !!res.ok, p_resultat: res.etat + " : " + res.detail }) });
  } catch (_) {}
  if (!res.ok && alerter !== false) {
    try {
      await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/notify_admins`, { method: "POST", headers: _sbHeaders(env), body: JSON.stringify({
        p_event_type: "payment_failed", p_title: "📱 SMS — rappels à débloquer chez Brevo",
        p_body: "Le numéro ..." + String(tel || "").replace(/\D/g, "").slice(-4) + " a répondu STOP à un SMS publicitaire. Blocage Brevo non levé automatiquement (" + res.etat + "). "
          + "Ses rappels de RDV risquent de ne pas partir : Brevo > Paramètres > SMS transactionnels > Contacts bloqués > débloquer ce numéro. L'opposition aux SMS publicitaires reste active chez Luxyra.",
        p_url: "/admin.html#sms", p_payload: { etat: res.etat } }) });
    } catch (_) {}
  }
  return res;
}
// Enregistre un STOP / START reçu de Brevo (accusé, webhook ou rattrapage). salonId : information seulement.
// evenementLe : date de l'événement Brevo (un STOP antérieur à une réinscription est ignoré par la base).
// STOP -> opposition gardée chez nous + levée du blocage Brevo (une fois par numéro) pour garder les rappels.
async function lxSmsStopEnregistrer(env, tel, action, source, salonId, details, evenementLe) {
  let res = null;
  try {
    const corps = { p_tel: String(tel || ""), p_action: action, p_source: source || null, p_salon: (/^[0-9a-f-]{36}$/i.test(String(salonId || "")) ? salonId : null), p_details: details ? String(details).slice(0, 300) : null };
    // ts_event des webhooks = secondes Unix ; API d'événements = ISO UTC
    const d = !evenementLe ? null : (typeof evenementLe === "number" || /^\d{9,11}$/.test(String(evenementLe)))
      ? new Date(Number(evenementLe) * 1000)
      : new Date(String(evenementLe).replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(evenementLe)) ? "" : "Z"));
    if (d && !isNaN(d.getTime())) corps.p_evenement_le = d.toISOString();
    const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/lx_sms_stop_enregistrer`, { method: "POST", headers: _sbHeaders(env), body: JSON.stringify(corps) });
    res = r.ok ? await r.json() : null;
  } catch (_) { res = null; }
  if (action === "stop" && res && res.ok && res.brevo_a_debloquer) {
    try { res.brevo = await lxBrevoSmsDebloquerTrace(env, tel); } catch (_) {}
  }
  return res;
}
// Événement Brevo -> 'stop' | 'start' | null. Brevo traite lui-même STOP/START (blocklist du compte) ; on recopie
// l'opposition dans lx_sms_stop (notre filtre des SMS publicitaires) puis on lève le blocage Brevo (rappels).
function lxSmsStopAction(ev, reponse) {
  const e = String(ev || "").toLowerCase().replace(/[\s_-]/g, "");
  if (e === "unsubscribe" || e === "unsubscribed" || e === "unsubscription") return "stop";
  if (e === "subscribe" || e === "subscribed") return "start";
  if (e === "replied" || e === "reply" || e === "replies") {
    const t = String(reponse || "").trim().toUpperCase();
    if (/^(STOP|STOPALL|ARRET|ARRÊT|UNSUBSCRIBE|UNSUB|END|QUIT|CANCEL)\b/.test(t)) return "stop";
    if (/^(START|YES)\b/.test(t)) return "start";
  }
  return null;
}
function lxSalonDuTag(tag) {
  const l = Array.isArray(tag) ? tag : [tag];
  for (const t of l) { const m = /^salon_([0-9a-f-]{36})$/i.exec(String(t || "")); if (m) return m[1]; }
  return null;
}
// POST /api/brevo/sms-stop?k=<BREVO_SMS_WEBHOOK_KEY> — webhook GLOBAL Brevo (Transactionnel > Webhooks SMS :
// Replied, Unsubscribe, Subscribe). Complète les accusés par message (/api/brevo/sms-event) et le rattrapage quotidien.
async function handleBrevoSmsStopWebhook(request, env) {
  try {
    const u = new URL(request.url);
    if (!env.BREVO_SMS_WEBHOOK_KEY || u.searchParams.get("k") !== env.BREVO_SMS_WEBHOOK_KEY) return jsonResponse({ error: "refusé" }, 403);
    let b = {}; try { b = await request.json(); } catch (_) {}
    const evs = Array.isArray(b) ? b : [b];
    let n = 0;
    for (const x of evs.slice(0, 50)) {
      const action = lxSmsStopAction(x && (x.msg_status || x.event || x.description), x && x.reply);
      if (action && x.to) { await lxSmsStopEnregistrer(env, x.to, action, "brevo_webhook", lxSalonDuTag(x.tag), x.reply ? "Réponse : " + String(x.reply).slice(0, 60) : (x.msg_status || ""), x.ts_event || null); n++; }
    }
    return jsonResponse({ ok: true, traites: n });
  } catch (e) {
    return jsonResponse({ ok: false }, 200); // jamais de nouvel essai en boucle côté Brevo
  }
}
// Rattrapage quotidien (cron 08:00 UTC) : désinscriptions et réponses STOP/START des 2 derniers jours lues dans
// l'API d'événements SMS de Brevo — fonctionne même si aucun webhook n'est configuré chez Brevo.
// 2026-10-17 soir : lit aussi le compte Brevo « marketing » (BREVO_API_KEY_MARKETING) s'il est configuré ; date de
// l'événement transmise (un STOP antérieur à une réinscription n'est pas recréé).
async function lxSmsStopRattrapage(env) {
  const cles = lxBrevoClesSms(env);
  if (!cles.length) return { ok: false, erreur: "BREVO_API_KEY absente" };
  const res = { stop: 0, start: 0, lus: 0 };
  for (const k of cles) {
    for (const evt of ["unsubscription", "replies"]) {
      for (let page = 0; page < 10; page++) {
        const r = await fetch(`https://api.brevo.com/v3/transactionalSMS/statistics/events?days=2&event=${evt}&limit=100&offset=${page * 100}&sort=asc`,
          { headers: { "api-key": k.cle, Accept: "application/json" } });
        if (!r.ok) break;
        const j = await r.json().catch(() => ({}));
        const L = Array.isArray(j.events) ? j.events : [];
        for (const x of L) {
          res.lus++;
          const action = lxSmsStopAction(x.event, x.reply);
          if (action && x.phoneNumber) { await lxSmsStopEnregistrer(env, x.phoneNumber, action, "brevo_rattrapage", lxSalonDuTag(x.tag), x.reply ? "Réponse : " + String(x.reply).slice(0, 60) : x.event, x.date || null); res[action]++; }
        }
        if (L.length < 100) break;
      }
    }
  }
  return res;
}

// POST /api/admin/sms-stop — admin (support@luxyra.fr + aal2) ou appel serveur (x-lx-internal = clé service).
//  {op:"etat", telephone}                : diagnostic lecture seule (lx_sms_stop, contact Brevo, événements 7 j)
//  {op:"reinscrire", telephone, motif}   : demande du client -> retrait de lx_sms_stop (SMS publicitaires de nouveau
//                                          possibles) + levée du blocage Brevo ; traces audit_log / admin_log
//  {op:"debloquer_brevo", telephone}     : numéro en lx_sms_stop : lève le blocage Brevo (rappels), opposition gardée
//  {op:"debloquer_brevo_tous", forcer}   : idem pour tous les numéros de lx_sms_stop pas encore débloqués (200 max)
async function handleAdminSmsStop(request, env) {
  try {
    let qui = "x-lx-internal";
    if (!(await lxIsInternal(request, env))) {
      const u = await lxAuthUser(request);
      if (!u || !lxIsAdminUser(u)) return jsonResponse({ error: "Accès réservé à l'administrateur" }, 403);
      qui = u.email;
    }
    let b = {}; try { b = await request.json(); } catch (_) {}
    const op = String(b.op || "");
    const tel = String(b.telephone || "").trim();
    const fin4 = tel.replace(/\D/g, "").slice(-4);
    if (op === "etat") {
      const intl = lxTelInternational(tel);
      if (!intl) return jsonResponse({ ok: false, error: "telephone invalide" }, 400);
      const out = { ok: true, telephone: "..." + fin4, comptes: [] };
      try {
        const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/lx_sms_stop?select=stop_le,source,details,brevo_debloque_le,brevo_resultat&telephone_norm=eq.${encodeURIComponent(lxTelNorm(tel))}`, { headers: _sbHeaders(env) });
        out.lx_sms_stop = r.ok ? ((await r.json())[0] || null) : "?";
      } catch (_) { out.lx_sms_stop = "?"; }
      for (const k of lxBrevoClesSms(env)) {
        const c = { compte: k.compte };
        try {
          const rc = await fetch(`https://api.brevo.com/v3/contacts/${encodeURIComponent(intl)}?identifierType=phone_id`, { headers: { "api-key": k.cle, Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
          const jc = rc.ok ? await rc.json().catch(() => ({})) : null;
          c.contact = rc.status === 404 ? "aucun" : (jc ? { id: jc.id, smsBlacklisted: jc.smsBlacklisted } : "HTTP " + rc.status);
        } catch (e) { c.contact = "erreur"; }
        try {
          const re = await fetch(`https://api.brevo.com/v3/transactionalSMS/statistics/events?days=7&limit=50&sort=desc&phoneNumber=${encodeURIComponent(intl.slice(1))}`, { headers: { "api-key": k.cle, Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
          const je = re.ok ? await re.json().catch(() => ({})) : null;
          c.evenements = je && Array.isArray(je.events) ? je.events.map((x) => ({ date: x.date, messageId: x.messageId, event: x.event, reason: x.reason, reply: x.reply })) : "HTTP " + re.status;
        } catch (e) { c.evenements = "erreur"; }
        out.comptes.push(c);
      }
      return jsonResponse(out);
    }
    if (op === "reinscrire") {
      if (!lxTelInternational(tel)) return jsonResponse({ ok: false, error: "telephone invalide" }, 400);
      const brevo = await lxBrevoSmsDebloquer(env, tel);
      const motif = String(b.motif || "Demande du client").slice(0, 160);
      const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/lx_sms_stop_enregistrer`, { method: "POST", headers: _sbHeaders(env),
        body: JSON.stringify({ p_tel: tel, p_action: "start", p_source: "admin_reinscription", p_salon: null,
          p_details: `Réinscription par ${qui} — ${motif} — Brevo : ${brevo.etat} (${brevo.detail})`.slice(0, 300) }) });
      const base = r.ok ? await r.json() : { ok: false, http: r.status };
      return jsonResponse({ ok: !!(base && base.ok), telephone: "..." + fin4, base, brevo,
        note: brevo.ok ? "Numéro réinscrit : SMS publicitaires et rappels possibles." : "Réinscrit chez Luxyra. Blocage Brevo à vérifier à la main : Brevo > Paramètres > SMS transactionnels > Contacts bloqués." });
    }
    if (op === "debloquer_brevo") {
      if (!lxTelInternational(tel)) return jsonResponse({ ok: false, error: "telephone invalide" }, 400);
      const brevo = await lxBrevoSmsDebloquerTrace(env, tel, false);
      return jsonResponse({ ok: brevo.ok, telephone: "..." + fin4, brevo, note: "Opposition aux SMS publicitaires conservée (lx_sms_stop)." });
    }
    if (op === "debloquer_brevo_tous") {
      const filtre = b.forcer ? "" : "&brevo_debloque_le=is.null";
      const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/lx_sms_stop?select=telephone_norm${filtre}&order=stop_le.asc&limit=200`, { headers: _sbHeaders(env) });
      const L = r.ok ? await r.json() : [];
      const res = { ok: true, traites: 0, debloques: 0, deja_libres: 0, sans_contact: 0, erreurs: 0, details: [] };
      for (const x of L) {
        const d = await lxBrevoSmsDebloquerTrace(env, x.telephone_norm, false);
        res.traites++;
        if (d.etat === "debloque") res.debloques++; else if (d.etat === "deja_libre") res.deja_libres++; else if (d.etat === "aucun_contact") res.sans_contact++; else res.erreurs++;
        res.details.push({ telephone: "..." + String(x.telephone_norm).slice(-4), etat: d.etat });
      }
      if (res.sans_contact || res.erreurs) res.note = "Numéros non débloqués automatiquement : Brevo > Paramètres > SMS transactionnels > Contacts bloqués (déblocage manuel, numéro par numéro).";
      return jsonResponse(res);
    }
    return jsonResponse({ ok: false, error: "op inconnue (etat, reinscrire, debloquer_brevo, debloquer_brevo_tous)" }, 400);
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e && e.message || e).slice(0, 200) }, 500);
  }
}

// 2026-10-10 : nouvel endpoint Brevo `/v3/transactionalSMS/send` (l'ancien `/sms` est déprécié) avec accusés de
// réception (webUrl) et un tag par salon. Repli automatique sur l'ancien endpoint si le nouveau est indisponible
// (5xx / 404) : un rappel ne doit jamais être perdu à cause du changement.
async function brevoSendSms(env, { to, content, sender, tag, webUrl, marketing }) {
  content = lxSmsGsm(content);
  // 2026-10-17 : SMS publicitaire -> type marketing. Plus de mention Brevo « STOP au [STOP_CODE] » (décision du 17/10) :
  // le lien « Stop SMS: luxyra.fr/s/<code> » est déjà dans le contenu (file SQL ou handleSmsCustom).
  const typeSms = marketing ? "marketing" : "transactional";
  // 2026-10-17 soir : compte Brevo dédié aux SMS publicitaires si configuré -> un STOP n'atteint jamais le compte des rappels
  const cleApi = (marketing && env.BREVO_API_KEY_MARKETING) ? env.BREVO_API_KEY_MARKETING : env.BREVO_API_KEY;
  const headers = { "api-key": cleApi, "Content-Type": "application/json", Accept: "application/json" };
  const destinataire = String(to || "").replace(/^\+/, "").replace(/\D/g, "");
  const corps = { type: typeSms, sender: sender || "Luxyra", recipient: destinataire, content };
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
  const corpsAncien = { type: typeSms, sender: sender || "Luxyra", recipient: to, content };
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
  // 2026-10-17 soir : somme des comptes Brevo SMS (principal + marketing éventuel)
  let brevo = null;
  for (const k of lxBrevoClesSms(env)) {
    try {
      const rb = await fetch(`https://api.brevo.com/v3/transactionalSMS/statistics/reports?startDate=${jour}&endDate=${jour}`, { headers: { "api-key": k.cle, Accept: "application/json" } });
      const jb = rb.ok ? await rb.json() : null;
      const repB = jb && Array.isArray(jb.reports) ? (jb.reports.find((x) => x.date === jour) || jb.reports[0] || null) : null;
      if (repB) brevo = (brevo || 0) + Number(repB.requests || 0);
      else if (k.compte === "principal") { brevo = null; break; } // pas de comparaison sans le compte principal
    } catch (_) { if (k.compte === "principal") { brevo = null; break; } }
  }
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
  // Compte Brevo marketing (s'il existe) : alerte une fois par jour si son solde est bas (sinon plus de campagnes)
  if (env.BREVO_API_KEY_MARKETING && env.BREVO_API_KEY_MARKETING !== env.BREVO_API_KEY) {
    try {
      const rm = await fetch("https://api.brevo.com/v3/account", { headers: { "api-key": env.BREVO_API_KEY_MARKETING, Accept: "application/json" } });
      const jm = rm.ok ? await rm.json() : null;
      const pm = jm && Array.isArray(jm.plan) ? jm.plan.find((x) => String(x.type || "").toLowerCase() === "sms") : null;
      if (pm && pm.credits != null && Number(pm.credits) < seuil) alertes.push(`Solde SMS du compte Brevo MARKETING bas : ${Number(pm.credits)} crédit(s). Les rappels ne sont pas concernés ; les campagnes SMS échoueront sans recharge.`);
    } catch (_) {}
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
    // 2026-10-17 soir : « bl » = événement Blacklisted des webhooks SMS Brevo (numéro en blocklist : SMS jamais parti),
    // « skip » = SMS ignoré par Brevo -> échec définitif, crédit rendu au salon.
    const echec = ["hardbounce", "rejected", "blocked", "skipped", "skip", "bl", "blacklisted", "error", "invalid", "undelivered", "failed", "expired"].includes(ev);
    const statut = ev === "delivered" ? "livre" : (echec ? "echec" : (ev === "softbounce" ? "en_attente" : null));
    const rq = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/sms_envois?select=evenements,statut,salon_id&id=eq.${encodeURIComponent(ref)}&limit=1`, { headers: _sbHeaders(env) });
    const ra = rq.ok ? await rq.json() : [];
    if (!ra[0]) return jsonResponse({ ok: true, inconnu: true });
    // 2026-10-17 : réponse STOP / START (ou désinscription) à ce SMS -> opposition aux SMS publicitaires (table lx_sms_stop)
    const _stopAct = lxSmsStopAction(ev, b.reply);
    if (_stopAct && b.to) {
      await lxSmsStopEnregistrer(env, b.to, _stopAct, "brevo_accuse", ra[0].salon_id, b.reply ? "Réponse : " + String(b.reply).slice(0, 60) : ev);
      return jsonResponse({ ok: true, stop: _stopAct }); // ne change pas le statut de livraison du SMS
    }
    const evts = Array.isArray(ra[0].evenements) ? ra[0].evenements.slice(-19) : [];
    evts.push({ e: ev || "?", r: raison || undefined, t: new Date().toISOString() });
    const patch = { evenements: evts, dernier_evenement: ev || null, maj_le: new Date().toISOString() };
    if (statut && ra[0].statut !== "livre") patch.statut = statut; // « livré » reste définitif
    await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/sms_envois?id=eq.${encodeURIComponent(ref)}`, { method: "PATCH", headers: _sbHeaders(env, { Prefer: "return=minimal" }), body: JSON.stringify(patch) });
    if (echec && ra[0].statut !== "livre") {
      await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/sms_envoi_rembourser`, { method: "POST", headers: _sbHeaders(env), body: JSON.stringify({ p_id: ref, p_motif: "SMS non distribué (" + ev + (raison ? " : " + raison : "") + ") — crédit rendu" }) });
    }
    // 2026-10-17 soir : rappel / confirmation bloqué par la blocklist Brevo alors que le numéro a seulement refusé la
    // publicité (lx_sms_stop) -> nouvelle tentative de déblocage + alerte admin si elle échoue
    if ((ev === "bl" || ev === "blacklisted") && b.to && String(b.type || "transactional").toLowerCase() !== "marketing") {
      try {
        const rs = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/lx_sms_pub_bloque`, { method: "POST", headers: _sbHeaders(env), body: JSON.stringify({ p_tel: String(b.to) }) });
        if (rs.ok && (await rs.json()) === true) await lxBrevoSmsDebloquerTrace(env, b.to);
      } catch (_) {}
    }
    return jsonResponse({ ok: true });
  } catch (e) {
    return jsonResponse({ ok: false }, 200); // jamais de nouvel essai en boucle côté Brevo
  }
}

// ============================================================
// 2026-10-15 MULTI-APPAREILS : ANTI-DOUBLON DES E-MAILS (/api/email/custom, /api/email/ticket)
// ------------------------------------------------------------
// Le 13/10, deux appareils du même salon ont envoyé le même rappel à la même cliente à 1 s d'intervalle.
// Désormais, AVANT d'appeler Brevo, le worker RÉSERVE une ligne messaging_log avec une clé dedup_key
// (index unique uniq_messaging_log_dedup) : le second envoi reçoit un conflit (409) et ne part pas.
//  - clé d'ÉVÉNEMENT fournie par l'app (dedupKey, ex. « <salon>|rappel_24h_email|<adresse>|<jour> ») : valable
//    sans limite de temps, acceptée seulement si elle commence par l'identifiant du salon de l'appelant ;
//  - sinon clé de CONTENU : empreinte (destinataire + objet + texte) par tranche de 10 min, la tranche
//    précédente étant aussi vérifiée -> un e-mail identique ne part pas deux fois en moins de 10 minutes.
// Échec d'envoi Brevo -> la réservation est supprimée (un nouvel essai reste possible).
// Appels serveur (x-lx-internal, rappels du cron) : déjà réservés par la fonction SQL -> rien ici.
// Réservation impossible (base injoignable) : l'e-mail part quand même (jamais zéro), sans clé.
// ============================================================
const LX_EMAIL_FENETRE_MS = 10 * 60 * 1000;
const LX_EMAIL_CONTEXTES = new Set(["luxyra_auto", "rappel_24h", "anniversaire", "relance", "carte_rappel_30j", "carte_rappel_7j", "ticket", "marketing"]); // 2026-10-17 : + marketing (campagnes)
// 2026-10-17 audit réglages (#4) : e-mails de prospection -> lien de désinscription obligatoire (fiche du salon)
const LX_EMAIL_CONTEXTES_MARKETING = new Set(["marketing", "anniversaire", "relance"]);
async function lxLienDesinscription(env, salonId, email, canal) {
  try {
    if (!salonId || !email) return "";
    const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/lx_lien_desinscription`, { method: "POST", headers: _sbHeaders(env),
      body: JSON.stringify({ p_salon: salonId, p_email: String(email).trim(), p_canal: canal || "email" }) });
    if (!r.ok) return "";
    const code = await r.json();
    // 2026-10-17 lien court : code de 6 caractères -> luxyra.fr/s/<code> ; ancien code de 10 -> luxyra.fr/stop/<code>
    if (typeof code === "string" && /^[a-z0-9]{6}$/.test(code)) return `https://luxyra.fr/s/${code}`;
    return (typeof code === "string" && /^[0-9a-f]{10}$/.test(code)) ? `https://luxyra.fr/stop/${code}` : "";
  } catch (_) { return ""; }
}
function lxAjouterPiedDesinscription(html, lien) {
  const pied = `<div style="text-align:center;font-size:11px;color:#999;padding:14px 10px;font-family:Arial,sans-serif">Vous ne souhaitez plus recevoir ces e-mails ? <a href="${lien}" style="color:#999;text-decoration:underline">Se désinscrire</a></div>`;
  const h = String(html || "");
  return /<\/body>/i.test(h) ? h.replace(/<\/body>/i, pied + "</body>") : h + pied;
}
async function lxSha256Hex(t) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(t)));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}
function lxEmailTexteNormalise(html) {
  return String(html || "").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ").trim().slice(0, 50000);
}
// Salon de l'appelant connecté : celui demandé s'il en est propriétaire, sinon son établissement ouvert.
async function lxEmailSalonAppelant(env, acces, salonIdDemande) {
  try {
    if (!acces || !acces.user || !acces.user.id) return null;
    if (salonIdDemande && await lxOwnsSalon(env, acces.user.id, salonIdDemande)) return String(salonIdDemande);
    if (lxIsAdminUser(acces.user)) return null;
    const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/salons?select=id&user_id=eq.${encodeURIComponent(acces.user.id)}&ferme_le=is.null&order=created_at.desc&limit=1`, { headers: _sbHeaders(env) });
    const a = r.ok ? await r.json() : [];
    return (Array.isArray(a) && a[0] && a[0].id) ? String(a[0].id) : null;
  } catch (e) { return null; }
}
// -> { doublon:true } | { cle, journalise:true } | { cle:null } (pas de réservation : envoi quand même)
async function lxEmailReserver(env, o) {
  try {
    if (!o || !o.salonId || !o.to) return { cle: null };
    const to = String(o.to).trim().toLowerCase();
    let contexte = LX_EMAIL_CONTEXTES.has(String(o.context || "")) ? String(o.context) : "luxyra_auto";
    let cle = null, precedente = null;
    const dk = (typeof o.dedupKey === "string") ? o.dedupKey.trim() : "";
    if (dk && dk.length <= 300 && dk.indexOf(o.salonId + "|") === 0) cle = dk;
    // « rappel_24h » sert aussi de verrou au rappel serveur : n'est accepté qu'avec la clé exacte du rappel
    if (contexte === "rappel_24h" && !(cle && new RegExp("^" + o.salonId + "\\|rappel_24h_email\\|" + to.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\|\\d{4}-\\d{2}-\\d{2}$").test(cle))) contexte = "luxyra_auto";
    if (!cle) {
      const h = (await lxSha256Hex(to + "\n" + String(o.subject || "") + "\n" + lxEmailTexteNormalise(o.html))).slice(0, 40);
      const tranche = Math.floor(Date.now() / LX_EMAIL_FENETRE_MS);
      cle = `${o.salonId}|email|${h}|${tranche}`; precedente = `${o.salonId}|email|${h}|${tranche - 1}`;
    }
    if (precedente) {
      const depuis = new Date(Date.now() - LX_EMAIL_FENETRE_MS).toISOString();
      const rp = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/messaging_log?select=id&dedup_key=eq.${encodeURIComponent(precedente)}&created_at=gte.${encodeURIComponent(depuis)}&limit=1`, { headers: _sbHeaders(env) });
      if (rp.ok) { const ap = await rp.json(); if (Array.isArray(ap) && ap.length) return { doublon: true }; }
    }
    const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/messaging_log`, {
      method: "POST", headers: _sbHeaders(env, { Prefer: "return=minimal" }),
      body: JSON.stringify({ salon_id: o.salonId, type: "email", recipient: to, content: String(o.subject || "").slice(0, 300), via: "brevo",
                             context: contexte, client_nom: o.toName ? String(o.toName).slice(0, 120) : null, dedup_key: cle })
    });
    if (r.status === 409) return { doublon: true };
    if (r.ok) return { cle, journalise: true };
    const t = await r.text().catch(() => "");
    if (/23505|duplicate key/i.test(t)) return { doublon: true };
    console.warn("[email anti-doublon] réservation impossible:", r.status, t.slice(0, 200));
    return { cle: null };
  } catch (e) { console.warn("[email anti-doublon]", e && e.message); return { cle: null }; }
}
async function lxEmailLiberer(env, cle) {
  if (!cle) return;
  try { await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/messaging_log?dedup_key=eq.${encodeURIComponent(cle)}`, { method: "DELETE", headers: _sbHeaders(env, { Prefer: "return=minimal" }) }); } catch (e) {}
}

// ============================================================
// EMAIL: TICKET — FIX W4: "conforme NF525" pas "certifié"
// ============================================================
async function handleEmailTicket(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!checkRateLimit("email_ticket:" + ip, 30)) return jsonResponse({ error: "Trop de requêtes. Réessayez dans 1 minute." }, 429);
  const body = await request.json();
  let { clientEmail, clientName, salonName, salonEmail, ticketNum, ticketHtml, clientId } = body;
  // SECURITE 2026-10-08 : salon connecte / appel serveur, OU client connecte (uniquement vers SA propre adresse)
  const _acces = await lxGuardConnecte(request, env);
  if (!_acces.ok) {
    const _cl = body.session_token ? await verifyClientSession(body.session_token, env) : null;
    if (!_cl || !_cl.email) return jsonResponse({ error: "Authentification requise" }, 401);
    // 2026-10-14 : envoi seulement vers une adresse VÉRIFIÉE (sinon le formulaire servait à écrire à n'importe qui)
    if (!lxEmailVerifie(_cl)) return jsonResponse({ error: "Confirmez d'abord votre adresse email (lien envoyé à l'inscription)." }, 403);
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
  // 2026-10-15 : anti-doublon (même ticket au même client en moins de 10 min, deux appareils / double appui)
  const _salonRes = _acces.ok ? await lxEmailSalonAppelant(env, _acces, body.salon_id) : null;
  const _res = _salonRes ? await lxEmailReserver(env, { salonId: _salonRes, to: clientEmail, toName: clientName, context: "ticket",
    subject: `Votre ticket N°${ticketNum} — ${salonName || ""}`, html: ticketHtml }) : { cle: null };
  if (_res.doublon) return jsonResponse({ success: true, deduplique: true, journalise: true });
  const encoder = new TextEncoder();
  const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Ticket ${salonName} N°${ticketNum}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Courier New',monospace;padding:15px;max-width:340px;margin:0 auto;font-size:12px;line-height:1.5;color:#000;background:#fff}table{width:100%;border-collapse:collapse}@media print{body{padding:5px}}</style></head><body>${ticketHtml}</body></html>`;
  const bytes = encoder.encode(fullHtml);
  let b64 = ""; for (let i = 0; i < bytes.length; i++) b64 += String.fromCharCode(bytes[i]); b64 = btoa(b64);
  let result;
  try {
    result = await brevoSendEmail(env, {
      to: clientEmail, toName: clientName, senderName: salonName || "Luxyra", senderEmail: "contact@luxyra.fr",
      replyTo: salonEmail, subject: `Votre ticket N°${ticketNum} — ${salonName || ""}`,
      htmlContent: emailHtml, textContent: `Bonjour, voici votre ticket N°${ticketNum} de ${salonName || "votre salon"}.`,
      attachment: [{ name: `Ticket-${ticketNum}-${(salonName||"Luxyra").replace(/[^a-zA-Z0-9]/g,"_")}.html`, content: b64 }]
    });
  } catch (e) { await lxEmailLiberer(env, _res.cle); throw e; }
  // 2026-10-15 : un refus de Brevo n'est plus annoncé comme un succès ; la réservation est libérée
  if (!result || (!result.messageId && (result.code || result.message))) {
    await lxEmailLiberer(env, _res.cle);
    return jsonResponse({ success: false, error: (result && (result.message || result.code)) || "envoi refusé", result });
  }
  return jsonResponse({ success: true, messageId: result.messageId, journalise: !!_res.journalise, result });
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
  // 2026-10-14 audit : les envois serveur (rappels e-mail en cron, x-lx-internal) partent tous de la meme IP :
  // la limite par IP ne s'applique qu'aux appels navigateur (sinon un lot de rappels serait coupe a 20/min).
  const _interneEm = await lxIsInternal(request, env);
  if (!_interneEm && !checkRateLimit("email_custom:" + ip, 20)) return jsonResponse({ error: "Trop de requêtes. Réessayez dans 1 minute." }, 429);
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
  const _corps = await request.json();
  const { to, toName, salonName, salonEmail, subject, htmlContent, textContent } = _corps;
  if (!to || !subject) return jsonResponse({ error: "to et subject requis" }, 400);
  // 2026-10-15 : anti-doublon multi-appareils (voir lxEmailReserver). Appels serveur : déjà réservés en base.
  let _res = { cle: null };
  if (_acces.ok && !_acces.internal) {
    const _salonRes = await lxEmailSalonAppelant(env, _acces, _corps.salon_id);
    if (_salonRes) _res = await lxEmailReserver(env, { salonId: _salonRes, to, toName, subject, html: htmlContent || textContent || "", context: _corps.context, dedupKey: _corps.dedupKey });
    if (_res.doublon) return jsonResponse({ success: true, deduplique: true, journalise: true });
  }
  // 2026-10-17 audit réglages (#4) : campagnes / anniversaires / relances -> lien « Se désinscrire » + en-tête List-Unsubscribe.
  // Lien fourni par le serveur (appel interne, déjà présent dans le HTML) ou calculé ici pour la fiche du salon de l'appelant.
  let _html = htmlContent || "", _texte = textContent || "", _entetes = null;
  if (LX_EMAIL_CONTEXTES_MARKETING.has(String(_corps.context || ""))) {
    let _lien = (_acces.internal && typeof _corps.unsubscribeUrl === "string" && /^https:\/\/luxyra\.fr\/stop\/[0-9a-f]{10}$/.test(_corps.unsubscribeUrl)) ? _corps.unsubscribeUrl : "";
    if (!_lien) {
      const _sl = _acces.internal ? (/^[0-9a-f-]{36}$/i.test(String(_corps.salon_id || "")) ? String(_corps.salon_id) : null) : await lxEmailSalonAppelant(env, _acces, _corps.salon_id);
      if (_sl) _lien = await lxLienDesinscription(env, _sl, to, "email");
    }
    if (_lien) {
      if (!/luxyra\.fr\/stop\/[0-9a-f]{10}|\/api\/unsubscribe\?/.test(_html)) _html = lxAjouterPiedDesinscription(_html, _lien);
      if (_texte && _texte.indexOf(_lien) < 0) _texte += "\n\nSe désinscrire : " + _lien;
      _entetes = { "List-Unsubscribe": `<${_lien}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
    }
  }
  let result;
  try {
    result = await brevoSendEmail(env, { to, toName, senderName: salonName || "Luxyra", senderEmail: "contact@luxyra.fr", replyTo: salonEmail, subject, htmlContent: _html, textContent: _texte, attachment: null, headers: _entetes });
  } catch (e) { await lxEmailLiberer(env, _res.cle); throw e; }
  if (result.code || result.message) { await lxEmailLiberer(env, _res.cle); return jsonResponse({ success: false, error: result.message || result.code, result }); }
  return jsonResponse({ success: true, messageId: result.messageId, journalise: !!_res.journalise, result });
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
async function lxEnvoyerSmsFacture(env, salonId, gate, phone, contenu, sender, opts) {
  const _marketing = !!(opts && opts.marketing); // 2026-10-17 : SMS publicitaire (type marketing ; lien Stop SMS déjà dans le texte)
  let result = null;
  let remaining = gate.remainingCredits, debites = gate.nbSms || 1;
  // 2026-10-10 : chaque envoi est suivi (sms_envois) -> accusés de réception, remboursement, rapprochement Brevo
  let ref = null;
  try {
    const ri = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/sms_envois`, { method: "POST", headers: _sbHeaders(env, { Prefer: "return=representation" }), body: JSON.stringify({ salon_id: salonId, nb_sms: debites }) });
    const ra = ri.ok ? await ri.json() : []; ref = ra[0] ? ra[0].id : null;
  } catch (_) {}
  const webUrl = ref ? `https://luxyra.fr/api/brevo/sms-event?r=${ref}&s=${await lxSigneRef(env, ref)}` : null;
  try { result = await brevoSendSms(env, { to: phone, content: contenu, sender, tag: "salon_" + salonId, webUrl, marketing: _marketing }); } catch (e) { result = { code: "exception", message: String(e?.message || e) }; }
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
  // 2026-10-14 audit : les envois du SERVEUR (file sms_differes, rappels 24h / 2h, anniversaires/relances : pg_net,
  // toujours la même adresse IP) ne sont plus limités à 15/minute — la file les envoie déjà par lots de 25 et
  // chaque envoi reste soumis au contrôle Pro + crédits. La limite par IP reste pour les appels depuis un appareil.
  const _interne = await lxIsInternal(request, env);
  if (!_interne && !checkRateLimit("sms:" + ip, 15)) return jsonResponse({ error: "Trop de requêtes SMS. Réessayez dans 1 minute." }, 429);
  const { telephone, message, salonName, salon_id, context } = await request.json();
  if (!telephone || !message) return jsonResponse({ error: "telephone et message requis" }, 400);
  let contenu = lxSmsGsm(message);
  if (!contenu) return jsonResponse({ error: "Message vide" }, 400);
  // 2026-10-17 : SMS publicitaire (contexte marketing / anniversaire / relance envoyé par l'app)
  // -> créneau légal, numéro ayant répondu STOP refusé (sans débit), lien « Stop SMS: luxyra.fr/s/<code> » ajouté
  //    (29 caractères, compté dans le coût). Sans lien possible (client absent du fichier) : refusé, sans débit.
  // Sans contexte (anciennes versions, rappels, confirmations) : comportement inchangé (transactionnel).
  const _pub = LX_SMS_PUB_CONTEXTES.has(String(context || ""));
  if (_pub) {
    if (!lxSmsPubCreneauOk(new Date())) return jsonResponse({ success: false, code: "hors_creneau", error: "SMS publicitaires autorisés du lundi au samedi de 8 h à 21 h 30, hors dimanche et jours fériés" }, 409);
    if (await lxSmsPubBloque(env, telephone)) return jsonResponse({ success: false, code: "stop", error: "Ce client a répondu STOP aux SMS publicitaires" }, 409);
  }
  if (_pub && !/luxyra\.fr\/(s|stop)\//i.test(contenu)) {
    let _code = null;
    try {
      const rc = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/lx_code_desinscription_sms`, { method: "POST", headers: _sbHeaders(env), body: JSON.stringify({ p_salon: salon_id || null, p_tel: String(telephone) }) });
      const jc = rc.ok ? await rc.json() : null;
      if (typeof jc === "string" && /^[a-z0-9]{6}$/.test(jc)) _code = jc;
    } catch (_) {}
    if (!_code) return jsonResponse({ success: false, code: "sans_lien", error: "SMS publicitaire non envoyé : lien de désinscription impossible (client absent du fichier du salon)" }, 409);
    contenu = contenu + LX_SMS_MENTION_PREFIXE + _code;
  }
  const _nbFactures = lxSmsSegments(contenu);
  // === Gate Pro + crédits + décrément (nombre réel de SMS facturés par Brevo) ===
  const gate = await gateSmsAndDecrementCredit(env, salon_id, _nbFactures);
  if (!gate.ok) {
    if (gate.status === 402 && salon_id) { try { await lxRechargeAutoSiBesoin(env, salon_id, 0); } catch (_) {} }
    return jsonResponse({ error: gate.error }, gate.status);
  }
  let phone = telephone.replace(/[\s.\-]/g, ""); if (phone.startsWith("0")) phone = "+33" + phone.slice(1);
  const env1 = await lxEnvoyerSmsFacture(env, salon_id, gate, phone, contenu, (salonName||"Luxyra").slice(0,11).trim(), { marketing: _pub });
  if (!env1.ok) return jsonResponse({ success: false, error: env1.error, result: env1.result, remainingCredits: env1.remaining, smsDebites: 0 }, 502);
  return jsonResponse({ success: true, result: env1.result, remainingCredits: env1.remaining, smsDebites: env1.debites });
}

async function handleClientTickets(request, env) {
  try {
    const _body = await request.json().catch(() => ({}));
    // SECURITE 2026-10-08 : l'email vient de la SESSION du client, jamais du corps de la requete.
    const _sess = await verifyClientSession(_body.session_token, env);
    if (!_sess || !_sess.lx_id) return jsonResponse({ error: "session_token invalide ou expiré", tickets: [] }, 401);
    // 2026-10-14 SECURITE : fiches rattachées par client_luxyra_id ; par email seulement si l'email est vérifié
    const email = lxEmailVerifie(_sess);
    const sbKey = env.SUPABASE_SERVICE_KEY;
    if (!sbKey) return jsonResponse({ error: "configuration_error", tickets: [] });
    const headers = { "apikey": sbKey, "Authorization": "Bearer " + sbKey, "Content-Type": "application/json" };
    const _filtreFiches = email
      ? `or=(client_luxyra_id.eq.${encodeURIComponent(_sess.lx_id)},email.eq.%22${encodeURIComponent(email)}%22)`
      : `client_luxyra_id=eq.${encodeURIComponent(_sess.lx_id)}`;
    const clients = await (await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/clients?select=id,salon_id,nom,prenom&${_filtreFiches}&limit=20`, { headers })).json();
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

// 2026-10-14 audit : identifiants d'un client connecté pour lire cartes / fidélité.
// - lxId : id du compte Luxyra (toujours) ;
// - clientIds : fiches de salon liées au compte (clients.client_luxyra_id) ;
// - emailVerifie : l'email ne sert de repli QUE s'il a été vérifié (clients_luxyra.email_verified).
function _lxPgrstVal(v) { return '"' + String(v || "").replace(/["\\]/g, "") + '"'; }
async function _lxIdsClientSession(env, session) {
  const out = { lxId: session && session.lx_id ? String(session.lx_id) : "", email: String((session && session.email) || "").toLowerCase().trim(), emailVerifie: false, clientIds: [] };
  if (!/^[0-9a-f-]{36}$/i.test(out.lxId)) { out.lxId = ""; return out; }
  try {
    if (session && typeof session.email_verified === "boolean") out.emailVerifie = session.email_verified;
    else {
      const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/clients_luxyra?select=email_verified&id=eq.${out.lxId}&limit=1`, { headers: _sbHeaders(env) });
      const d = await r.json();
      out.emailVerifie = !!(Array.isArray(d) && d[0] && d[0].email_verified === true);
    }
  } catch (_) { out.emailVerifie = false; }
  if (!out.email) out.emailVerifie = false;
  try {
    const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/clients?select=id&client_luxyra_id=eq.${out.lxId}&limit=50`, { headers: _sbHeaders(env) });
    const d = await r.json();
    if (Array.isArray(d)) out.clientIds = d.map(x => x.id).filter(x => /^[0-9a-f-]{36}$/i.test(String(x)));
  } catch (_) {}
  return out;
}

// GET cartes d'abonnement du client (cross-salons par défaut, filtrable par salon_id)
async function handleClientCartes(request, env) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) return jsonResponse({ error: "body invalide" }, 400);
    const session = await verifyClientSession(body.session_token, env);
    if (!session) return jsonResponse({ error: "session_token invalide ou expiré" }, 401);
    // 2026-10-14 audit : l'app enregistre les cartes avec client_luxyra_id = id du compte Luxyra
    // (repli : email) et client_id = fiche du salon. On cherche donc par compte + fiches liées,
    // l'email n'est plus qu'un repli quand il est vérifié.
    const _ids = await _lxIdsClientSession(env, session);
    if (!_ids.lxId) return jsonResponse({ error: "session invalide" }, 401);
    // Filtre optionnel salon_id (utilisé par site.html quand on est sur la page d'un seul salon)
    const salonId = body.salon_id ? String(body.salon_id) : null;
    const onlyActive = body.only_active === true;
    const _or = [`client_luxyra_id.eq.${_ids.lxId}`];
    if (_ids.clientIds.length) _or.push(`client_id.in.(${_ids.clientIds.join(",")})`);
    if (_ids.emailVerifie) _or.push(`client_luxyra_id.eq.${_lxPgrstVal(_ids.email)}`);
    let url = `${CONFIG.SUPABASE_URL}/rest/v1/cartes_abo_clients?select=*&or=(${encodeURIComponent(_or.join(","))})`;
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
    // 2026-10-14 audit : l'app écrit fidelite_client.client_luxyra_id = id du compte Luxyra
    // (repli : email). On lit d'abord par id de compte, l'email seulement s'il est vérifié.
    const _ids = await _lxIdsClientSession(env, session);
    const email = _ids.emailVerifie ? _ids.email : "";
    const lxId = _ids.lxId;
    const salonId = body.salon_id ? String(body.salon_id) : null;
    function _buildUrl(idVal) {
      let u = `${CONFIG.SUPABASE_URL}/rest/v1/fidelite_client?select=*&client_luxyra_id=eq.${encodeURIComponent(idVal)}`;
      if (salonId) u += `&salon_id=eq.${encodeURIComponent(salonId)}`;
      u += `&order=derniere_visite.desc`;
      return u;
    }
    let fidelite = [];
    if (lxId) {
      try {
        const r1 = await fetch(_buildUrl(lxId), { headers: _sbHeaders(env) });
        const d1 = await r1.json();
        if (Array.isArray(d1)) fidelite = d1;
      } catch (e) {}
    }
    // repli email (vérifié) : seulement pour les établissements pas déjà trouvés par l'id
    if (email) {
      try {
        const r2 = await fetch(_buildUrl(email), { headers: _sbHeaders(env) });
        const d2 = await r2.json();
        if (Array.isArray(d2)) {
          const _vus = new Set(fidelite.map(f => f.salon_id));
          d2.forEach(f => { if (!_vus.has(f.salon_id)) fidelite.push(f); });
        }
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
// 2026-10-13 : alertes « une place s'est libérée » (liste d'attente par prestation)
function lxPlageDe(heure) { const h = parseInt(String(heure || "0").slice(0, 2), 10); return h < 12 ? "matin" : h < 17 ? "apres_midi" : "soir"; }
async function handleClientAlertes(request, env) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) return jsonResponse({ error: "body invalide" }, 400);
    const session = await verifyClientSession(body.session_token, env);
    if (!session) return jsonResponse({ error: "Connectez-vous pour créer une alerte" }, 401);
    const lx = session.lx_id, H = _sbHeaders(env), base = `${CONFIG.SUPABASE_URL}/rest/v1`;
    const op = String(body.op || "list");
    const today = lxParisAujourdhui(); // 2026-10-14 : date de Paris (avant : UTC+2 fixe, faux en hiver)
    if (op === "create") {
      const sid = String(body.salon_id || "");
      if (!/^[0-9a-f-]{36}$/i.test(sid)) return jsonResponse({ error: "établissement invalide" }, 400);
      const svcId = parseInt(body.service_id, 10);
      if (!svcId) return jsonResponse({ error: "Choisissez la prestation" }, 400);
      const sv = await (await fetch(`${base}/services?id=eq.${svcId}&salon_id=eq.${sid}&actif=eq.true&select=id,nom,phases`, { headers: H })).json();
      if (!Array.isArray(sv) || !sv[0]) return jsonResponse({ error: "Prestation introuvable" }, 400);
      const duree = Math.max(5, (Array.isArray(sv[0].phases) ? sv[0].phases : []).reduce((t, p) => t + (Number(p && p.d) || 0), 0) || 30);
      const d1 = /^\d{4}-\d{2}-\d{2}$/.test(body.date_debut || "") ? body.date_debut : today;
      let d2 = /^\d{4}-\d{2}-\d{2}$/.test(body.date_fin || "") ? body.date_fin : d1;
      if (d1 < today) return jsonResponse({ error: "Date passée" }, 400);
      const maxFin = new Date(new Date(d1 + "T12:00:00Z").getTime() + 31 * 864e5).toISOString().slice(0, 10);
      if (d2 < d1) d2 = d1; if (d2 > maxFin) d2 = maxFin;
      const plage = ["tous", "matin", "apres_midi", "soir"].includes(body.plage) ? body.plage : "tous";
      const act = await (await fetch(`${base}/creneau_alertes?client_luxyra_id=eq.${lx}&actif=eq.true&date_fin=gte.${today}&select=id`, { headers: H })).json();
      if (Array.isArray(act) && act.length >= 3) return jsonResponse({ error: "Vous avez déjà 3 alertes actives : supprimez-en une dans Mes RDV." }, 400);
      const r = await fetch(`${base}/creneau_alertes`, { method: "POST", headers: { ...H, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ salon_id: sid, client_luxyra_id: lx, service_id: svcId, service_nom: sv[0].nom || "", duree_minutes: duree, date_debut: d1, date_fin: d2, plage }) });
      if (!r.ok) return jsonResponse({ error: "Création impossible" }, 400);
    } else if (op === "delete") {
      const id = String(body.id || "");
      if (/^[0-9a-f-]{36}$/i.test(id)) await fetch(`${base}/creneau_alertes?id=eq.${id}&client_luxyra_id=eq.${lx}`, { method: "PATCH", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ actif: false }) });
    }
    const rows = await (await fetch(`${base}/creneau_alertes?client_luxyra_id=eq.${lx}&actif=eq.true&date_fin=gte.${today}&select=id,salon_id,service_nom,date_debut,date_fin,plage,salons(nom,slug)&order=created_at.desc`, { headers: H })).json();
    return jsonResponse({ ok: true, alertes: (Array.isArray(rows) ? rows : []).map((x) => ({ id: x.id, salon_id: x.salon_id, salon_nom: x.salons ? x.salons.nom : "", salon_slug: x.salons ? x.salons.slug : "", service_nom: x.service_nom, date_debut: x.date_debut, date_fin: x.date_fin, plage: x.plage })) });
  } catch (e) { return jsonResponse({ error: "Erreur alertes" }, 500); }
}
// Appelé par la base (déclencheur) quand un rendez-vous est annulé ou déplacé
async function handleCreneauLibere(request, env) {
  try {
    // Authentification : identifiant à usage unique d'une ligne de la file creneau_liberes (créée par la base)
    const b = await request.json().catch(() => ({}));
    const qid = String(b.id || "");
    if (!/^[0-9a-f-]{36}$/i.test(qid)) return jsonResponse({ error: "forbidden" }, 403);
    const H = _sbHeaders(env), base = `${CONFIG.SUPABASE_URL}/rest/v1`;
    const qr = await (await fetch(`${base}/creneau_liberes?id=eq.${qid}&traite_at=is.null&select=salon_id,date_rdv,heure,duree,created_at`, { headers: H })).json();
    if (!Array.isArray(qr) || !qr[0] || (Date.now() - new Date(qr[0].created_at).getTime()) > 3600e3) return jsonResponse({ error: "forbidden" }, 403);
    await fetch(`${base}/creneau_liberes?id=eq.${qid}`, { method: "PATCH", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ traite_at: new Date().toISOString() }) });
    const sid = qr[0].salon_id, date = String(qr[0].date_rdv), heure = String(qr[0].heure || "").slice(0, 5), duree = Math.max(30, parseInt(qr[0].duree, 10) || 30);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(heure)) return jsonResponse({ error: "params" }, 400);
    const plage = lxPlageDe(heure);
    const cutoff = new Date(Date.now() - 30 * 60e3).toISOString();
    const al = await (await fetch(`${base}/creneau_alertes?salon_id=eq.${sid}&actif=eq.true&date_debut=lte.${date}&date_fin=gte.${date}&duree_minutes=lte.${duree}&plage=in.(tous,${plage})&or=(derniere_alerte_at.is.null,derniere_alerte_at.lt.${encodeURIComponent(cutoff)})&select=id,client_luxyra_id,service_id,service_nom&limit=50`, { headers: H })).json();
    if (!Array.isArray(al) || !al.length) return jsonResponse({ ok: true, envoyes: 0 });
    const sal = await (await fetch(`${base}/salons_public?id=eq.${sid}&select=nom,slug`, { headers: H })).json();
    const salon = Array.isArray(sal) && sal[0] ? sal[0] : null;
    if (!salon || !salon.slug) return jsonResponse({ ok: true, envoyes: 0 });
    const jour = new Date(date + "T12:00:00Z").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris" });
    let n = 0;
    for (const a of al) {
      const cl = await (await fetch(`${base}/clients_luxyra?id=eq.${a.client_luxyra_id}&select=email,prenom`, { headers: H })).json();
      const c = Array.isArray(cl) && cl[0] ? cl[0] : null;
      if (!c || !c.email) continue;
      const lien = `https://luxyra.fr/${encodeURIComponent(salon.slug)}/reserver?d=${date}&h=${encodeURIComponent(heure)}${a.service_id ? "&book=" + a.service_id : ""}`;
      const esc = (t) => String(t || "").replace(/[&<>"]/g, (x) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[x]));
      const corps = `<p style="font-size:15px;color:#333;line-height:1.6">Bonjour ${esc(c.prenom || "")},</p>
<p style="font-size:15px;color:#333;line-height:1.6">Bonne nouvelle : une place vient de se libérer chez <b>${esc(salon.nom)}</b> le <b>${esc(jour)} à ${esc(heure)}</b>${a.service_nom ? ` pour « ${esc(a.service_nom)} »` : ""}.</p>
<p style="font-size:14px;color:#666;line-height:1.6">Les autres personnes en attente ont reçu le même message : la place revient à la première qui réserve.</p>
${lxMailBouton("Réserver cette place", lien)}
<p style="font-size:12px;color:#999;line-height:1.5">Vous recevez ce message car vous avez demandé à être prévenu(e). Gérer ou arrêter vos alertes : <a href="https://luxyra.fr/compte.html?tab=rdv" style="color:#a88a3e">Mes RDV</a>.</p>`;
      // 2026-10-13 : aussi dans l'appli (cloche + notification sur le téléphone si activée)
      await fetch(`${base}/rpc/lx_notifier_client`, { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ p_client: a.client_luxyra_id, p_type: "place_liberee", p_titre: `🔔 Une place s'est libérée chez ${salon.nom}`, p_texte: `Le ${jour} à ${heure}${a.service_nom ? " pour « " + a.service_nom + " »" : ""}. La place revient à la première personne qui réserve.`, p_url: lien }) }).catch(() => {});
      try {
        await brevoSendEmail(env, { to: c.email, subject: `Une place s'est libérée chez ${salon.nom}`, htmlContent: lxMailLayout(corps, { titre: "Une place s'est libérée" }), textContent: `Une place s'est libérée chez ${salon.nom} le ${jour} à ${heure}. Réserver : ${lien}` });
        n++;
        await fetch(`${base}/creneau_alertes?id=eq.${a.id}`, { method: "PATCH", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ derniere_alerte_at: new Date().toISOString() }) });
        await fetch(`${base}/rpc/lx_alerte_incrementer`, { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ p_id: a.id }) }).catch(() => {});
      } catch (_) {}
    }
    await fetch(`${base}/creneau_liberes?id=eq.${qid}`, { method: "PATCH", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ envoyes: n }) }).catch(() => {});
    return jsonResponse({ ok: true, envoyes: n });
  } catch (e) { return jsonResponse({ error: "Erreur" }, 500); }
}
// 2026-10-13 : notifications d'un compte client (cloche de l'appli + notifications du téléphone)
async function handleClientNotifs(request, env) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) return jsonResponse({ error: "body invalide" }, 400);
    const session = await verifyClientSession(body.session_token, env);
    if (!session) return jsonResponse({ error: "Connectez-vous" }, 401);
    const lx = encodeURIComponent(session.lx_id), H = _sbHeaders(env), base = `${CONFIG.SUPABASE_URL}/rest/v1`;
    const op = String(body.op || "list");
    const J = { ...H, "Content-Type": "application/json" };
    if (op === "subscribe" || op === "unsubscribe") {
      const sub = body.subscription || {};
      const ep = String(sub.endpoint || "");
      if (!/^https:\/\/[^\s]{10,900}$/.test(ep)) return jsonResponse({ error: "abonnement invalide" }, 400);
      if (op === "unsubscribe") {
        await fetch(`${base}/client_push_subscriptions?client_luxyra_id=eq.${lx}&endpoint=eq.${encodeURIComponent(ep)}`, { method: "DELETE", headers: H });
        return jsonResponse({ ok: true });
      }
      const k = sub.keys || {};
      if (!k.p256dh || !k.auth || String(k.p256dh).length > 200 || String(k.auth).length > 100) return jsonResponse({ error: "clés invalides" }, 400);
      // 2026-10-14 : un navigateur = un seul compte. On retire cet abonnement des AUTRES comptes (appareil partagé :
      // sinon le compte précédent continuait à recevoir ses notifications sur ce navigateur).
      await fetch(`${base}/client_push_subscriptions?endpoint=eq.${encodeURIComponent(ep)}&client_luxyra_id=neq.${lx}`, { method: "DELETE", headers: H }).catch(() => {});
      const r = await fetch(`${base}/client_push_subscriptions?on_conflict=endpoint,client_luxyra_id`, { method: "POST", headers: { ...J, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ client_luxyra_id: session.lx_id, endpoint: ep, p256dh: String(k.p256dh), auth: String(k.auth), last_used_at: new Date().toISOString() }) });
      if (!r.ok) return jsonResponse({ error: "Activation impossible" }, 400);
      return jsonResponse({ ok: true });
    }
    if (op === "read_all") {
      await fetch(`${base}/client_notifications?client_luxyra_id=eq.${lx}&lu=eq.false`, { method: "PATCH", headers: J, body: JSON.stringify({ lu: true }) });
    } else if (op === "read") {
      const id = parseInt(body.id, 10);
      if (id) await fetch(`${base}/client_notifications?client_luxyra_id=eq.${lx}&id=eq.${id}`, { method: "PATCH", headers: J, body: JSON.stringify({ lu: true }) });
    }
    if (op === "count") {
      const c = await fetch(`${base}/client_notifications?client_luxyra_id=eq.${lx}&lu=eq.false&select=id`, { headers: { ...H, Prefer: "count=exact", Range: "0-0" } });
      const cr = c.headers.get("content-range") || "";
      return jsonResponse({ ok: true, non_lues: parseInt(cr.split("/")[1], 10) || 0 });
    }
    const rows = await (await fetch(`${base}/client_notifications?client_luxyra_id=eq.${lx}&select=id,type,titre,texte,url,lu,created_at&order=created_at.desc&limit=50`, { headers: H })).json();
    const list = Array.isArray(rows) ? rows : [];
    return jsonResponse({ ok: true, notifications: list, non_lues: list.filter((x) => !x.lu).length });
  } catch (e) { return jsonResponse({ error: "Erreur notifications" }, 500); }
}
// 2026-10-13 : salons favoris d'un compte client (liste / ajout-retrait)
async function handleClientFavoris(request, env) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) return jsonResponse({ error: "body invalide" }, 400);
    const session = await verifyClientSession(body.session_token, env);
    if (!session) return jsonResponse({ error: "Connectez-vous pour gérer vos favoris" }, 401);
    const lx = encodeURIComponent(session.lx_id);
    const H = _sbHeaders(env);
    const op = String(body.op || "list");
    if (op === "toggle") {
      const sid = String(body.salon_id || "");
      if (!/^[0-9a-f-]{36}$/i.test(sid)) return jsonResponse({ error: "salon invalide" }, 400);
      const ex = await (await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/client_favoris?client_luxyra_id=eq.${lx}&salon_id=eq.${sid}&select=salon_id`, { headers: H })).json();
      if (Array.isArray(ex) && ex.length) {
        await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/client_favoris?client_luxyra_id=eq.${lx}&salon_id=eq.${sid}`, { method: "DELETE", headers: H });
      } else {
        const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/client_favoris`, { method: "POST", headers: { ...H, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ client_luxyra_id: session.lx_id, salon_id: sid }) });
        if (!r.ok) return jsonResponse({ error: "Ajout impossible" }, 400);
      }
    }
    const rows = await (await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/client_favoris?client_luxyra_id=eq.${lx}&select=salon_id,created_at&order=created_at.desc&limit=100`, { headers: H })).json();
    const ids = (Array.isArray(rows) ? rows : []).map((x) => x.salon_id);
    let salons = [];
    if (ids.length) {
      const sp = await (await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/salons_public?id=in.(${ids.join(",")})&select=id,nom,slug,ville,metier,note_moyenne,nb_avis`, { headers: H })).json();
      const byId = {}; (Array.isArray(sp) ? sp : []).forEach((x) => { byId[x.id] = x; });
      salons = ids.map((id) => byId[id]).filter(Boolean);
    }
    return jsonResponse({ ok: true, favoris: salons });
  } catch (e) {
    return jsonResponse({ error: "Erreur favoris" }, 500);
  }
}
async function handleClientRdvs(request, env) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) return jsonResponse({ error: "body invalide" }, 400);
    const session = await verifyClientSession(body.session_token, env);
    if (!session) return jsonResponse({ error: "session_token invalide ou expiré" }, 401);
    const lxId = session.lx_id;
    const email = lxEmailVerifie(session); // 2026-10-14 : par email seulement si vérifié
    const salonId = body.salon_id ? String(body.salon_id) : null;
    // 2 fetches : par luxyra_id (uuid) puis par email (text, si vérifié). Dedupe sur id.
    const seen = new Set();
    // Dédup LOGIQUE : un même créneau peut exister dans rdv_online ET appointments
    // (résa en ligne miroitée au planning). id différents → on déduplique sur salon+date+heure.
    const seenSlot = new Set();
    const _slotKey = (sid, d, h) => String(sid || "") + "|" + String(d || "") + "|" + String(h || "").slice(0, 5);
    const rdvs = [];
    async function _fetch(filter) {
      try {
        let u = `${CONFIG.SUPABASE_URL}/rest/v1/rdv_online?select=*,salons(nom,slug,adresse,cp,ville,mode_activite)&${filter}`;
        if (salonId) u += `&salon_id=eq.${encodeURIComponent(salonId)}`;
        u += `&order=date_rdv.desc&limit=50`;
        const r = await fetch(u, { headers: _sbHeaders(env) });
        const data = await r.json();
        if (!Array.isArray(data)) return;
        for (const d of data) {
          if (seen.has(d.id)) continue;
          seen.add(d.id);
          d.salon_nom = d.salons ? d.salons.nom : "";
          // 2026-10-13 : pour « Reprendre ce RDV », l'agenda et l'itinéraire (adresse masquée pour le domicile)
          if (d.salons) { d.salon_slug = d.salons.slug || ""; if (String(d.salons.mode_activite || "") !== "domicile") d.salon_adresse = [d.salons.adresse, d.salons.cp, d.salons.ville].filter(Boolean).join(" "); }
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
        const _today = lxParisAujourdhui(); // 2026-10-14 : date de Paris
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
              const _sr = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/salons?select=nom,slug,adresse,cp,ville,mode_activite&id=eq.${_sid}&limit=1`, { headers: _sbHeaders(env) });
              const _sd = await _sr.json();
              if (Array.isArray(_sd) && _sd[0]) { _snames[_sid] = _sd[0].nom; _snames["slug:" + _sid] = _sd[0].slug || ""; if (String(_sd[0].mode_activite || "") !== "domicile") _snames["adr:" + _sid] = [_sd[0].adresse, _sd[0].cp, _sd[0].ville].filter(Boolean).join(" "); }
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
              id: a.id, salon_id: a.salon_id, salon_nom: _snames[a.salon_id] || "", salon_slug: _snames["slug:" + a.salon_id] || "", salon_adresse: _snames["adr:" + a.salon_id] || "",
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
            const h = lxPolitiqueHeures(c.politique_annulation); // 2026-10-14 : même règle que le contrôle serveur
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
// 2026-10-10 : page publique de paiement de l'acompte d'un RDV accepté par le professionnel (lien envoyé par SMS/email).
// Accès par jeton aléatoire uniquement ; ne renvoie que le strict nécessaire à l'affichage.
async function handleRdvAcompteInfo(request, env) {
  try {
    const b = await readJsonBody(request);
    const t = String(b.t || "");
    if (!/^[A-Za-z0-9]{10,40}$/.test(t)) return jsonResponse({ error: "Lien invalide" }, 400);
    if (!checkRateLimit("acompte_info:" + (request.headers.get("CF-Connecting-IP") || "?"), 30)) return jsonResponse({ error: "Trop de requêtes" }, 429);
    const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rdv_online?select=id,salon_id,status,service_nom,date_rdv,heure_rdv,acompte_montant,acompte_paye,client_email,client_prenom,lieu&acompte_token=eq.${encodeURIComponent(t)}&limit=1`, { headers: _sbHeaders(env) });
    const a = r.ok ? await r.json() : [];
    const rdv = Array.isArray(a) ? a[0] : null;
    if (!rdv) return jsonResponse({ error: "Lien invalide ou expiré" }, 404);
    const salon = await supabaseGet(env, rdv.salon_id);
    const connectOk = !!(salon && salon.stripe_connect_id && ["active", "enabled", "payouts_pending"].includes(String(salon.stripe_connect_status || "")));
    return jsonResponse({ ok: true, rdv_id: rdv.id, salon_id: rdv.salon_id, salon_nom: salon ? salon.nom : "", salon_logo: salon ? (salon.logo || "") : "",
      prestation: rdv.service_nom || "", date: rdv.date_rdv, heure: rdv.heure_rdv ? String(rdv.heure_rdv).slice(0, 5) : "",
      montant: Number(rdv.acompte_montant) || 0, paye: rdv.acompte_paye === true, annule: rdv.status === "cancelled" || rdv.status === "refused" || rdv.status === "done",
      email: rdv.client_email || "", prenom: rdv.client_prenom || "", domicile: rdv.lieu === "domicile", paiement_en_ligne: connectOk });
  } catch (e) { return jsonResponse({ error: "Erreur" }, 500); }
}
// 2026-10-14 (NF525 acompte en ligne) : l'enregistrement du paiement (acompte_paye=true, PATCH ci-dessous ou rejoué par le webhook
// Connect) déclenche côté base le trigger trg_rdv_online_acompte_modele -> rdv_online.acompte_modele='ticket' (nouveau modèle) ;
// acompte_paye_at est posé par trigger (= date de règlement). L'application PRO crée ensuite le ticket scellé « Acompte en ligne »
// (lxAcomptesEnLigneSync). Le worker n'écrit volontairement AUCUNE de ces nouvelles colonnes : il reste fonctionnel même si le
// script SQL n'est pas encore appliqué, et un acompte payé avant la mise en service garde acompte_modele NULL (ancien modèle).
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
      const _r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rdv_online?select=id,salon_id,status,acompte_paye,acompte_montant,payment_intent_id,refund_id,refund_error&id=eq.${encodeURIComponent(rdv_id)}&limit=1`, { headers: _sbHeaders(env) });
      const _a = _r.ok ? await _r.json() : [];
      const _rdv = Array.isArray(_a) ? _a[0] : null;
      if (!_rdv) return jsonResponse({ error: "RDV introuvable" }, 404);
      if (String(session.metadata.salon_id || "") !== String(_rdv.salon_id)) return jsonResponse({ error: "Session non liée à ce salon" }, 403);
      if (_rdv.acompte_paye === true) {
        if (piId && String(_rdv.payment_intent_id || "") === String(piId)) return jsonResponse({ ok: true, payment_intent_id: piId, deja: true });
        return jsonResponse({ error: "Acompte déjà enregistré pour ce rendez-vous" }, 409);
      }
      // 2026-10-14 audit : le montant payé doit être EXACTEMENT l'acompte enregistré (avant : seul un montant inférieur était
      // refusé, un trop-perçu était accepté et encaissé). Écart -> paiement remboursé en totalité, alerte critique, acompte non enregistré.
      const _attendu = Math.round((Number(_rdv.acompte_montant) || 0) * 100);
      if (!(_attendu > 0) || typeof session.amount_total !== "number" || session.amount_total !== _attendu) {
        // 2026-10-14 audit : page de retour + webhook Connect arrivent tous deux ici -> UN seul remboursement et
        // UNE seule alerte. Déjà fait si : marqueur posé sur le RDV pour CE paiement, ou remboursement existant
        // chez Stripe pour ce payment_intent. Le remboursement porte en plus une clé d'idempotence Stripe.
        const _cpt = _compteA || null;
        const _marq = "montant_incoherent " + String(piId || "");
        if (piId && _rdv.refund_id && String(_rdv.refund_error || "").indexOf(_marq) >= 0) {
          return jsonResponse({ error: "Montant payé incohérent avec l'acompte : le paiement est remboursé.", rembourse: true, deja: true }, 409);
        }
        let _rbt = null, _dejaRbt = false;
        try {
          if (piId) {
            const _ex = await stripeAPI(env, `refunds?payment_intent=${encodeURIComponent(piId)}&limit=10`, null, "GET", _cpt);
            const _ok = (_ex && Array.isArray(_ex.data)) ? _ex.data.find((x) => x && x.id && !["failed", "canceled"].includes(String(x.status || ""))) : null;
            if (_ok) { _rbt = _ok.id; _dejaRbt = true; }
            else {
              const _idem = "lx_acompte_incoherent_" + piId;
              const _rf = _cpt
                ? await stripeAPI(env, "refunds", { payment_intent: piId, "metadata[rdv_id]": String(rdv_id), "metadata[motif]": "montant_incoherent" }, "POST", _cpt, _idem)
                : await stripeAPI(env, "refunds", { payment_intent: piId, reverse_transfer: "true", "metadata[rdv_id]": String(rdv_id), "metadata[motif]": "montant_incoherent" }, "POST", null, _idem);
              _rbt = (_rf && _rf.id) ? _rf.id : ((_rf && _rf.error && (_rf.error.message || _rf.error.code)) || "échec");
            }
          }
        } catch (_eRf) { _rbt = "exception " + (_eRf && _eRf.message); }
        const _rembOk = !!(_rbt && String(_rbt).startsWith("re_"));
        if (_rembOk) {
          // Trace sur le RDV (refund_id + marqueur du paiement). PAS de refunded_at / acompte_rembourse : l'acompte
          // n'a jamais été enregistré, l'application ne doit pas afficher « acompte remboursé ».
          try { await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rdv_online?id=eq.${encodeURIComponent(rdv_id)}&acompte_paye=not.is.true`, { method: "PATCH", headers: _sbHeaders(env, { "Prefer": "return=minimal" }), body: JSON.stringify({ refund_id: _rbt, refund_error: (_marq + " : paiement remboursé en totalité (" + _rbt + ")").slice(0, 500) }) }); } catch (_) {}
        }
        if (!_dejaRbt) await reportWorkerError(env, "worker:acompte-finalize", new Error("Montant paye different de l'acompte : paiement rembourse"), { rdv_id, paye: session.amount_total, attendu: _attendu, payment_intent: piId, remboursement: _rbt }, "critical");
        return jsonResponse({ error: "Montant payé incohérent avec l'acompte : le paiement est remboursé.", rembourse: _rembOk }, 409);
      }
      // Statut decide par le salon (confirmation automatique ou non), pas par la page.
      try {
        const _c = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/site_config?select=confirmation_auto&salon_id=eq.${encodeURIComponent(_rdv.salon_id)}&limit=1`, { headers: _sbHeaders(env) });
        const _ca = _c.ok ? await _c.json() : [];
        if (Array.isArray(_ca) && _ca[0] && typeof _ca[0].confirmation_auto === "boolean") wantStatus = _ca[0].confirmation_auto ? "confirmed" : "pending";
      } catch (_e) {}
      // 2026-10-10 : acompte réglé APRÈS acceptation par le professionnel -> le RDV reste confirmé
      if (_rdv.status === "confirmed") wantStatus = "confirmed";
      // 2026-10-11 : RDV annulé / refusé / terminé entre-temps -> on n'y touche pas (paiement à rembourser)
      if (["cancelled", "refused", "done"].includes(String(_rdv.status || ""))) {
        await reportWorkerError(env, "worker:acompte-finalize", new Error("Acompte payé sur un RDV " + _rdv.status + " : à rembourser"), { rdv_id, payment_intent: piId }, "critical");
        const _p = { acompte_paye: true, stripe_account: _compteA || null }; if (piId) { _p.payment_intent_id = piId; _p.stripe_payment_id = piId; }
        await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rdv_online?id=eq.${encodeURIComponent(rdv_id)}`, { method: "PATCH", headers: _sbHeaders(env, { "Prefer": "return=minimal" }), body: JSON.stringify(_p) });
        return jsonResponse({ error: "Ce rendez-vous n'est plus actif : le paiement sera remboursé", a_rembourser: true }, 409);
      }
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
// 2026-10-14 : lecture UNIQUE de la politique d'annulation (même règle que compte.html / site.html).
// -1 = « jamais » (annulation en ligne désactivée), 0 = aucun délai, sinon heures (« N h » ou « N j » -> N*24).
function lxPolitiqueHeures(raw) {
  const s = String(raw == null || raw === "" ? "48h" : raw).trim().toLowerCase();
  if (s === "jamais" || s === "non" || s === "no" || s === "never") return -1;
  if (s === "0" || s === "0h" || s === "aucun" || s === "aucun délai" || s === "aucun delai") return 0;
  const m = s.match(/(\d+)/);
  if (!m) return 48;
  const n = parseInt(m[1], 10);
  if (/\d\s*(j|jour|jours|d|day|days)\b/.test(s)) return n * 24;
  return n;
}
// 2026-10-14 : heure « murale » de Paris (date YYYY-MM-DD + HH:MM[:SS]) -> vrai instant UTC (gère l'heure d'été).
// Avant : new Date(`${date}T${heure}`) dans le worker = heure UTC -> 1 à 2 h d'écart sur les délais.
function lxParisVersDate(dateStr, heureStr) {
  const dm = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ""));
  if (!dm) return new Date(NaN);
  const hm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(heureStr || "00:00"));
  const y = +dm[1], mo = +dm[2], d = +dm[3], h = hm ? +hm[1] : 0, mi = hm ? +hm[2] : 0, se = hm && hm[3] ? +hm[3] : 0;
  const mur = Date.UTC(y, mo - 1, d, h, mi, se);
  const decalage = (t) => {
    try {
      const p = {};
      for (const x of new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(t))) p[x.type] = x.value;
      return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - t;
    } catch (_) { return 3600000; }
  };
  let t = mur - decalage(mur);
  t = mur - decalage(t); // 2e passe : changement d'heure entre les deux estimations
  return new Date(t);
}
// 2026-10-14 : date du jour à Paris (YYYY-MM-DD).
function lxParisAujourdhui(d) {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(d || new Date()); }
  catch (_) { return (d || new Date()).toISOString().slice(0, 10); }
}
// 2026-10-14 : contrôle serveur du délai d'annulation par le client (miroir de compte.html canCancel).
// Retourne null si l'annulation est permise, sinon le message d'erreur (409).
async function lxControleAnnulationClient(env, rdv) {
  let policyHours = 48;
  try {
    const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/site_config?select=politique_annulation&salon_id=eq.${encodeURIComponent(rdv.salon_id)}&limit=1`, { headers: _sbHeaders(env) });
    const rows = r.ok ? await r.json() : [];
    policyHours = lxPolitiqueHeures(Array.isArray(rows) && rows[0] ? rows[0].politique_annulation : null);
  } catch (_) {}
  if (policyHours === -1) return "Ce rendez-vous ne peut pas être annulé en ligne : contactez l'établissement.";
  if (policyHours === 0) return null;
  if (!rdv.date_rdv) return null;
  const debut = lxParisVersDate(rdv.date_rdv, rdv.heure_rdv || "09:00");
  const hoursBefore = (debut.getTime() - Date.now()) / 3600000;
  if (isFinite(hoursBefore) && hoursBefore < policyHours) return `Ce rendez-vous ne peut plus être annulé en ligne (moins de ${policyHours}h avant) : contactez l'établissement.`;
  return null;
}
async function attemptAcompteRefund(env, rdv) {
  try {
    if (!rdv) return { refunded: false, error: "rdv manquant" };
    if (rdv.acompte_rembourse === true) return { refunded: false, skipped: "déjà remboursé" };
    if (rdv.acompte_paye !== true) return { refunded: false, skipped: "acompte non payé" };
    const montant = Number(rdv.acompte_montant) || 0;
    if (montant <= 0) return { refunded: false, skipped: "montant nul" };
    // 2026-10-14 audit : un RDV REFUSÉ par l'établissement (ou refusé pendant le paiement) dont l'acompte a été payé est
    // remboursé comme une annulation par l'établissement (toujours en totalité, sans politique d'annulation).
    const _refuse = rdv.status === "refused";
    if (rdv.status !== "cancelled" && !_refuse) return { refunded: false, skipped: "non annulé" };

    // 2026-10-10 : client absent (choix du salon dans le planning) -> acompte conservé.
    if (rdv.retenue_at || rdv.retenue_tk_num) return { refunded: false, skipped: "acompte déjà conservé (enregistré en caisse)" };
    if (rdv.cancelled_by === "no_show") return { refunded: false, skipped: "client absent : acompte conservé", conserve: true };
    // 2026-10-10 : annulation PAR LE SALON (à partir de cette version) -> acompte TOUJOURS remboursé ; la politique
    // d'annulation et son délai ne s'appliquent qu'aux annulations du client (et aux annulations antérieures).
    const _parSalon = _refuse || (rdv.cancelled_by === "salon" && rdv.cancelled_at && String(rdv.cancelled_at) >= "2026-10-10T21:30:00");
    if (!_parSalon) {
      // 1) Politique d'annulation du salon (site_config — SINGULIER)
      let policyHours = 48, remboursementOn = true, pctPartiel = 0;
      try {
        const cfgRes = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/site_config?select=politique_annulation,remboursement_annulation,remboursement_partiel_pct&salon_id=eq.${encodeURIComponent(rdv.salon_id)}&limit=1`, { headers: _sbHeaders(env) });
        if (cfgRes.ok) {
          const rows = await cfgRes.json();
          if (Array.isArray(rows) && rows[0]) {
            remboursementOn = rows[0].remboursement_annulation !== false;
            pctPartiel = Math.max(0, Math.min(100, parseInt(rows[0].remboursement_partiel_pct, 10) || 0));
            // 2026-10-14 : « jamais » = -1 (avant : lu comme 48h)
            policyHours = lxPolitiqueHeures(rows[0].politique_annulation);
          }
        }
      } catch (_) {}
      // 2026-10-13 : remboursement partiel automatique (pourcentage choisi par l'établissement) quand l'acompte serait conservé
      const _partiel = async (raison) => {
        const deja = Number(rdv.acompte_rembourse_montant) || 0;
        const cents = Math.floor(Math.round(montant * 100) * pctPartiel / 100) - Math.round(deja * 100);
        if (!(pctPartiel > 0) || !(cents > 0)) return { refunded: false, skipped: raison, conserve: true };
        const rf = await lxRembourserAcompteStripe(env, rdv, cents);
        if (!rf.ok) return { refunded: false, error: rf.error, payment_intent: rf.payment_intent };
        if (Math.round(deja * 100) + cents >= Math.round(montant * 100)) return { refunded: true, refund_id: rf.refund_id, payment_intent: rf.payment_intent, status: rf.status };
        return { refunded: true, partial: true, montant_rembourse: Math.round(deja * 100 + cents) / 100, refund_id: rf.refund_id, payment_intent: rf.payment_intent, status: rf.status, conserve: true };
      };
      if (!remboursementOn) return await _partiel("remboursement désactivé par le salon");

      // 2026-10-14 : annulation en ligne interdite par l'établissement -> acompte non remboursé automatiquement
      // (règle -1 réservée aux annulations par le CLIENT ; anciens cas salon/système : ancienne lecture 48 h)
      if (policyHours === -1 && rdv.cancelled_by === "client") return await _partiel("annulation en ligne désactivée par l'établissement");
      if (policyHours === -1) policyHours = 48;
      // 2) Délai : annulation au moins policyHours avant le RDV
      try {
        if (rdv.date_rdv && rdv.heure_rdv) {
          const rdvStart = lxParisVersDate(rdv.date_rdv, rdv.heure_rdv); // 2026-10-14 : heure de Paris
          const cancelTime = rdv.cancelled_at ? new Date(rdv.cancelled_at) : new Date();
          const hoursBefore = (rdvStart.getTime() - cancelTime.getTime()) / 3600000;
          if (isFinite(hoursBefore) && hoursBefore < policyHours) {
            return await _partiel(`hors délai (${Math.round(hoursBefore)}h < ${policyHours}h)`);
          }
        }
      } catch (_) {}
    }

    // 3) Remboursement du reste (déduction faite d'un éventuel remboursement partiel déjà fait)
    const _deja = Math.round((Number(rdv.acompte_rembourse_montant) || 0) * 100);
    if (_deja > 0) {
      const rf = await lxRembourserAcompteStripe(env, rdv, Math.round(montant * 100) - _deja);
      if (!rf.ok) return { refunded: false, error: rf.error, payment_intent: rf.payment_intent };
      return { refunded: true, refund_id: rf.refund_id, payment_intent: rf.payment_intent, status: rf.status };
    }
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

// 2026-10-13 : l'établissement rembourse TOUT ou PARTIE d'un acompte payé en ligne (au cas par cas : % ou montant).
// Route salon (propriétaire vérifié par LX_ROUTES_SALON). ANCIEN MODÈLE (acompte_modele NULL) : la partie conservée est
// enregistrée en caisse par l'application (ticket scellé « Acompte conservé », montant = acompte - remboursé) ; interdit si ce
// ticket existe déjà (passer par un avoir). NOUVEAU MODÈLE 2026-10-14 (acompte_modele='ticket') : la recette est déjà scellée
// (ticket d'acompte au paiement) ; chaque entrée ajoutée à `remboursements` ({at, montant, refund_id, par}) devient UN ticket
// négatif « Remboursement acompte en ligne » créé par l'application (clé = refund_id, posée une seule fois : champ tk) ;
// retenue_tk_num / retenue_claim_at ne sont jamais posés pour ces acomptes (la règle 409 ci-dessous ne les concerne pas).
// INVARIANT : toute entrée de `remboursements` porte at + montant + refund_id (clé de ticketage) — ne pas en ajouter sans refund_id.
async function handleAcompteRembourser(request, env) {
  try {
    const b = await request.json().catch(() => ({}));
    const sid = String(b.salon_id || ""), rid = String(b.rdv_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(sid) || !/^[0-9a-f-]{36}$/i.test(rid)) return jsonResponse({ error: "paramètres invalides" }, 400);
    const H = _sbHeaders(env), base = `${CONFIG.SUPABASE_URL}/rest/v1`;
    const sel0 = "id,salon_id,status,cancelled_by,acompte_paye,acompte_montant,acompte_rembourse,acompte_rembourse_montant,retenue_at,retenue_tk_num,retenue_claim_at,payment_intent_id,stripe_payment_id,stripe_account,created_at,client_email,client_luxyra_id,date_rdv,heure_rdv,refund_attempted_at,remboursements";
    // 2026-10-14 (2e revue) : acompte_modele lu si la colonne existe (script SQL appliqué) ; sinon relecture sans (ancien modèle partout)
    let rows = await (await fetch(`${base}/rdv_online?id=eq.${rid}&salon_id=eq.${sid}&select=${sel0},acompte_modele`, { headers: H })).json();
    if (!Array.isArray(rows)) rows = await (await fetch(`${base}/rdv_online?id=eq.${rid}&salon_id=eq.${sid}&select=${sel0}`, { headers: H })).json();
    const rdv = Array.isArray(rows) && rows[0];
    if (!rdv) return jsonResponse({ error: "Rendez-vous introuvable" }, 404);
    const acompte = Math.round((Number(rdv.acompte_montant) || 0) * 100);
    const deja = Math.round((Number(rdv.acompte_rembourse_montant) || 0) * 100);
    if (rdv.acompte_paye !== true || !(acompte > 0)) return jsonResponse({ error: "Aucun acompte payé en ligne sur ce rendez-vous" }, 400);
    if (rdv.acompte_rembourse === true || deja >= acompte) return jsonResponse({ error: "L'acompte est déjà entièrement remboursé" }, 400);
    if (rdv.retenue_tk_num || rdv.retenue_claim_at) return jsonResponse({ error: "La partie conservée est déjà enregistrée en caisse : un remboursement passe maintenant par un avoir en caisse." }, 409);
    const noShow = b.no_show === true;
    // 2026-10-14 (2e revue) : TROP-PERÇU (nouveau modèle uniquement) — l'acompte scellé dépasse le total du ticket final : la caisse
    // rembourse la différence AVANT d'encaisser. RDV encore à venir / en cours (pending / confirmed : ni annulé, ni encaissé) ;
    // statut et retenue_at inchangés ; l'entrée remboursements porte par:"trop_percu" (ticket négatif créé par l'application).
    const tropPercu = b.trop_percu === true;
    if (tropPercu) {
      if (rdv.acompte_modele !== "ticket") return jsonResponse({ error: "Trop-perçu : réservé aux acomptes enregistrés en caisse dès le paiement (nouveau modèle)." }, 400);
      if (!["confirmed", "pending"].includes(rdv.status)) return jsonResponse({ error: "Trop-perçu : le rendez-vous doit être à venir (ni annulé, ni encaissé)." }, 400);
    } else {
      if (!(rdv.status === "cancelled" || (noShow && ["confirmed", "pending"].includes(rdv.status)))) return jsonResponse({ error: "Rendez-vous non annulé" }, 400);
      // annulé par l'établissement (ou dans les délais) : l'acompte est remboursé EN ENTIER automatiquement, pas de partiel
      if (rdv.status === "cancelled" && (rdv.cancelled_by === "salon" || !rdv.retenue_at)) return jsonResponse({ error: "Cet acompte est remboursé en entier automatiquement (annulation par l'établissement ou dans les délais)." }, 400);
    }
    const cents = Math.round(Number(b.montant) * 100);
    if (!(cents > 0) || cents > acompte - deja) return jsonResponse({ error: `Montant invalide (maximum ${((acompte - deja) / 100).toFixed(2).replace(".", ",")} €)` }, 400);
    // verrou anti double-clic : une seule demande à la fois pour ce rendez-vous
    const lock = await fetch(`${base}/rdv_online?id=eq.${rid}&acompte_rembourse_montant=eq.${deja / 100}&retenue_claim_at=is.null&retenue_tk_num=is.null&or=(refund_attempted_at.is.null,refund_attempted_at.lt.${encodeURIComponent(new Date(Date.now() - 60e3).toISOString())})`, {
      method: "PATCH", headers: { ...H, "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify({ refund_attempted_at: new Date().toISOString() }) });
    const lk = await lock.json().catch(() => []);
    if (!Array.isArray(lk) || !lk.length) return jsonResponse({ error: "Un remboursement est déjà en cours pour ce rendez-vous" }, 409);
    const rf = await lxRembourserAcompteStripe(env, rdv, cents);
    if (!rf.ok) {
      await fetch(`${base}/rdv_online?id=eq.${rid}`, { method: "PATCH", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ refund_error: String(rf.error || "").slice(0, 500) }) });
      return jsonResponse({ error: "Stripe : " + (rf.error || "remboursement refusé") }, 502);
    }
    const nowIso = new Date().toISOString(), total = deja + cents, complet = total >= acompte;
    const patch = { acompte_rembourse_montant: total / 100, refund_id: rf.refund_id, refunded_at: nowIso, refund_error: null,
      remboursements: (Array.isArray(rdv.remboursements) ? rdv.remboursements : []).concat([{ at: nowIso, montant: cents / 100, refund_id: rf.refund_id, par: tropPercu ? "trop_percu" : "etablissement" }]) };
    if (rf.payment_intent && !rdv.payment_intent_id) patch.payment_intent_id = rf.payment_intent;
    if (tropPercu) {
      // trop-perçu : ni statut, ni retenue_at (le RDV reste à encaisser ; la part conservée = total du ticket est déduite au ticket final)
      if (complet) patch.acompte_rembourse = true;
    } else {
      if (complet) patch.acompte_rembourse = true; else if (!rdv.retenue_at) patch.retenue_at = nowIso;
      if (noShow && rdv.status !== "cancelled") Object.assign(patch, { status: "cancelled", cancelled_by: "no_show", cancel_reason: "Client absent (no-show)", cancelled_at: nowIso });
    }
    const _fin = await fetch(`${base}/rdv_online?id=eq.${rid}`, { method: "PATCH", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    if (!_fin.ok) {
      try { await reportWorkerError(env, "acompte:remboursement_partiel", new Error("Remboursement Stripe fait mais base non mise à jour : " + (await _fin.text()).slice(0, 300)), { rdv_id: rid, refund_id: rf.refund_id, cents }, "critical"); } catch (_) {}
      return jsonResponse({ error: "Remboursement effectué chez Stripe (" + rf.refund_id + ") mais non enregistré : ne recommencez pas, prévenez le support." }, 500);
    }
    if (rdv.client_luxyra_id) {
      const eur = (cents / 100).toFixed(2).replace(".", ",");
      await fetch(`${base}/rpc/lx_notifier_client`, { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ p_client: rdv.client_luxyra_id, p_type: "remboursement", p_titre: "💶 Remboursement de " + eur + " €", p_texte: "L'établissement vous rembourse " + eur + " € sur l'acompte de votre rendez-vous du " + String(rdv.date_rdv).split("-").reverse().join("/") + ". Délai bancaire de quelques jours.", p_url: "https://luxyra.fr/compte.html?tab=rdv" }) }).catch(() => {});
    }
    return jsonResponse({ ok: true, rembourse: total / 100, conserve: (acompte - total) / 100, complet });
  } catch (e) { return jsonResponse({ error: "Erreur remboursement" }, 500); }
}
// 2026-10-13 : remboursement Stripe d'une partie (ou du reste) d'un acompte de RDV. cents = montant en centimes.
async function lxRembourserAcompteStripe(env, rdv, cents) {
  try {
    cents = Math.round(Number(cents) || 0);
    if (!(cents > 0)) return { ok: false, error: "montant nul" };
    const meta = { "metadata[rdv_id]": String(rdv.id || ""), "metadata[salon_id]": String(rdv.salon_id || "") };
    if (rdv.stripe_account && rdv.payment_intent_id) {
      const rf = await stripeAPI(env, "refunds", { payment_intent: rdv.payment_intent_id, amount: String(cents), ...meta }, "POST", rdv.stripe_account);
      if (!rf || rf.error || !rf.id) return { ok: false, error: (rf && rf.error && rf.error.message) || "échec refund Stripe", payment_intent: rdv.payment_intent_id };
      return { ok: true, refund_id: rf.id, payment_intent: rdv.payment_intent_id, status: rf.status };
    }
    let piId = rdv.payment_intent_id || null;
    if (!piId && rdv.stripe_payment_id && String(rdv.stripe_payment_id).startsWith("pi_")) piId = rdv.stripe_payment_id;
    if (!piId) piId = await findAcompteChargePI(env, rdv, Number(rdv.acompte_montant) || 0);
    if (!piId) return { ok: false, error: "payment_intent introuvable" };
    const rf = await stripeAPI(env, "refunds", { payment_intent: piId, amount: String(cents), reverse_transfer: "true", ...meta });
    if (!rf || rf.error || !rf.id) return { ok: false, error: (rf && rf.error && (rf.error.message || rf.error)) || "échec refund Stripe", payment_intent: piId };
    return { ok: true, refund_id: rf.id, payment_intent: piId, status: rf.status };
  } catch (e) { return { ok: false, error: e.message || "exception refund" }; }
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
    const email = String(rdv.client_email || "").trim().toLowerCase();
    // 2026-10-14 : sans email client, aucune correspondance sûre -> on ne rembourse jamais « au hasard »
    if (!email) return null;
    const list = await stripeAPI(env, `charges?limit=100&created[gte]=${gte}&created[lte]=${lte}`, null, "GET");
    if (!list || !Array.isArray(list.data)) return null;
    const matches = list.data.filter(c =>
      c && c.paid === true && c.refunded === false && c.status === "succeeded" &&
      c.currency === "eur" && c.amount === amountCents &&
      ((c.transfer_data && c.transfer_data.destination === dest) || c.destination === dest) &&
      (
        (c.billing_details && c.billing_details.email && c.billing_details.email.trim().toLowerCase() === email) ||
        (c.receipt_email && c.receipt_email.trim().toLowerCase() === email)
      )
    );
    if (matches.length === 1 && matches[0].payment_intent) return matches[0].payment_intent;
    return null;
  } catch (_) { return null; }
}

// Tente le remboursement et enregistre le résultat dans rdv_online (idempotent).
// 2026-10-08 : annulation par le client d'un RDV garanti par empreinte.
// Dans le délai de la politique d'annulation -> empreinte libérée tout de suite (sinon les fonds
// restaient bloqués jusqu'à 7 jours). Hors délai -> on la laisse : le salon décide (bouton
// « Capturer » ou « Libérer » dans le planning), sinon Stripe la libère seul après 7 jours.
async function releaseEmpreinteOnCancel(env, rdv) {
  if (!rdv || rdv.empreinte_status !== "held" || !rdv.payment_intent_id) return { skipped: "pas d'empreinte active" };
  let policyHours = 48;
  try {
    const cfgRes = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/site_config?select=politique_annulation&salon_id=eq.${encodeURIComponent(rdv.salon_id)}&limit=1`, { headers: _sbHeaders(env) });
    const rows = cfgRes.ok ? await cfgRes.json() : [];
    policyHours = lxPolitiqueHeures(rows && rows[0] ? rows[0].politique_annulation : null); // 2026-10-14 : helper unique
  } catch (_) {}
  // 2026-10-14 : « jamais » -> pas de libération automatique, l'établissement décide
  if (policyHours === -1) return { skipped: "annulation en ligne désactivée : décision du salon" };
  const rdvStart = lxParisVersDate(rdv.date_rdv, rdv.heure_rdv); // 2026-10-14 : heure de Paris
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

// 2026-10-14 (NF525 acompte en ligne) : chaque entrée ajoutée à `remboursements` (partiel « politique » ou total « automatique ») est
// ticketée en caisse par l'application pour les acomptes du nouveau modèle (ticket négatif par entrée, clé = refund_id).
async function refundAndRecord(env, rdv) {
  const r = await attemptAcompteRefund(env, rdv);
  const nowIso = new Date().toISOString();
  const patch = { refund_attempted_at: nowIso };
  const _hist = Array.isArray(rdv.remboursements) ? rdv.remboursements : [];
  const _deja = Number(rdv.acompte_rembourse_montant) || 0;
  if (r.refunded && r.partial) {
    // 2026-10-13 : remboursement PARTIEL -> le reste est conservé (ticket scellé pour la partie conservée)
    patch.remboursements = _hist.concat([{ at: nowIso, montant: Math.round((r.montant_rembourse - _deja) * 100) / 100, refund_id: r.refund_id, par: "politique" }]);
    patch.acompte_rembourse_montant = r.montant_rembourse;
    patch.refund_id = r.refund_id;
    patch.refunded_at = nowIso;
    patch.refund_error = null;
    if (!rdv.retenue_at) patch.retenue_at = nowIso;
    if (r.payment_intent && !rdv.payment_intent_id) patch.payment_intent_id = r.payment_intent;
  } else if (r.refunded) {
    patch.remboursements = _hist.concat([{ at: nowIso, montant: Math.round(((Number(rdv.acompte_montant) || 0) - _deja) * 100) / 100, refund_id: r.refund_id, par: "automatique" }]);
    patch.acompte_rembourse = true;
    patch.acompte_rembourse_montant = Number(rdv.acompte_montant) || 0;
    patch.refund_id = r.refund_id;
    patch.refunded_at = nowIso;
    patch.refund_error = null;
    if (r.payment_intent && !rdv.payment_intent_id) patch.payment_intent_id = r.payment_intent;
  } else if (r.error) {
    patch.refund_error = String(r.error).slice(0, 500);
  } else if (r.skipped) {
    patch.refund_error = "skip: " + r.skipped;
    // 2026-10-11 : décision DÉFINITIVE « acompte conservé » -> l'app l'enregistre en caisse (ticket scellé)
    // et le cron ne reviendra plus dessus.
    if (r.conserve && !rdv.retenue_at) patch.retenue_at = nowIso;
  }
  try {
    const _p = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rdv_online?id=eq.${encodeURIComponent(rdv.id)}`, {
      method: "PATCH", headers: _sbHeaders(env, { "Prefer": "return=minimal" }), body: JSON.stringify(patch)
    });
    if (!_p.ok && r.refunded) { try { await reportWorkerError(env, "refund:enregistrement", new Error("Remboursement fait mais base non mise à jour : " + (await _p.text()).slice(0, 300)), { rdv_id: rdv.id, refund_id: r.refund_id }, "critical"); } catch (_) {} }
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
  const sel = "id,salon_id,status,acompte_paye,acompte_montant,acompte_rembourse,payment_intent_id,stripe_payment_id,stripe_account,date_rdv,heure_rdv,created_at,cancelled_at,cancelled_by,client_email,refund_error,retenue_at,acompte_rembourse_montant,remboursements";
  // 2026-10-14 audit : + RDV REFUSÉS (par l'établissement, ou pendant le paiement) dont l'acompte a été payé : avant, seuls les
  // RDV « cancelled » étaient remboursés -> un acompte payé sur un RDV refusé recevait son ticket scellé mais jamais de
  // remboursement. Un refusé n'a pas de cancelled_at : fenêtre sur la date de paiement (ou de création).
  const _or = `(and(status.eq.cancelled,cancelled_at.gte.${since}),and(status.eq.refused,or(acompte_paye_at.gte.${since},created_at.gte.${since})))`;
  const q = `${CONFIG.SUPABASE_URL}/rest/v1/rdv_online?select=${sel}&or=${encodeURIComponent(_or)}&acompte_paye=eq.true&acompte_rembourse=eq.false&acompte_montant=gt.0&retenue_at=is.null&limit=50`;
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
      `${CONFIG.SUPABASE_URL}/rest/v1/rdv_online?select=id,client_luxyra_id,client_email,salon_id,status,acompte_paye,acompte_montant,acompte_rembourse,acompte_rembourse_montant,remboursements,retenue_at,retenue_tk_num,cancelled_by,payment_intent_id,stripe_payment_id,stripe_account,date_rdv,heure_rdv,created_at,empreinte_status&id=eq.${encodeURIComponent(rdvId)}&limit=1`,
      { headers: _sbHeaders(env) }
    );
    const own = await ownRes.json();
    if (!Array.isArray(own) || !own[0]) return jsonResponse({ error: "RDV introuvable" }, 404);
    // 2026-10-14 SECURITE : rattachement par email seulement si l'email du compte est vérifié
    const owns = (own[0].client_luxyra_id && String(own[0].client_luxyra_id) === session.lx_id) ||
                 (!!lxEmailVerifie(session) && own[0].client_email && String(own[0].client_email).toLowerCase() === session.email);
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
    // SECURITE 2026-10-08 : le client ne peut que ANNULER (statut), avec une date d'annulation serveur.
    if ("status" in patch && patch.status !== "cancelled") delete patch.status;
    delete patch.cancelled_at; delete patch.cancelled_by;
    if (patch.status === "cancelled") { patch.cancelled_at = new Date().toISOString(); patch.cancelled_by = "client"; }
    if (Object.keys(patch).length === 0) return jsonResponse({ error: "rien à patcher" }, 400);
    // 2026-10-14 SECURITE : demande de modification contrôlée (le client ne peut pas « accepter » sa propre demande).
    const _modif = ["modification_demandee", "modification_date", "modification_heure", "modification_message", "modification_status"].some((k) => k in patch);
    if (_modif) {
      if ("modification_status" in patch && patch.modification_status !== "pending") return jsonResponse({ error: "Statut de modification invalide" }, 400);
      if ("modification_demandee" in patch) patch.modification_demandee = patch.modification_demandee === true;
      if ("modification_date" in patch) {
        const _d = String(patch.modification_date || "");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(_d) || isNaN(Date.parse(_d + "T12:00:00Z")) || new Date(_d + "T12:00:00Z").toISOString().slice(0, 10) !== _d) return jsonResponse({ error: "Date invalide" }, 400);
        if (_d < lxParisAujourdhui()) return jsonResponse({ error: "La date choisie est déjà passée" }, 400);
      }
      if ("modification_heure" in patch) {
        const _h = String(patch.modification_heure || "");
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(_h)) return jsonResponse({ error: "Heure invalide (format HH:MM)" }, 400);
      }
      if ("modification_message" in patch && patch.modification_message != null) patch.modification_message = String(patch.modification_message).slice(0, 500);
    }
    // 2026-10-14 SECURITE : annulation par le client = même règle que l'espace client (délai de la politique d'annulation)
    if (patch.status === "cancelled" && ["pending", "confirmed"].includes(String(own[0].status || ""))) {
      const _refus = await lxControleAnnulationClient(env, own[0]);
      if (_refus) return jsonResponse({ error: _refus }, 409);
    }
    // 2026-10-13 SECURITE : une annulation ne vaut que pour un rendez-vous encore actif (sinon un RDV déjà annulé
    // -- client absent, acompte conservé et enregistré en caisse -- pouvait être « ré-annulé » et l'acompte remboursé).
    // 2026-10-14 : idem pour une demande de modification.
    const _filtreActif = (patch.status === "cancelled" || _modif) ? "&status=in.(pending,confirmed)" : "";
    const upd = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/rdv_online?id=eq.${encodeURIComponent(rdvId)}${_filtreActif}`,
      { method: "PATCH", headers: _sbHeaders(env, { "Prefer": "return=representation" }), body: JSON.stringify(patch) }
    );
    if (!upd.ok) {
      const t = await upd.text();
      return jsonResponse({ error: "update échoué: " + t }, 500);
    }
    const _updRows = await upd.json().catch(() => []);
    if (patch.status === "cancelled" && (!Array.isArray(_updRows) || !_updRows.length)) return jsonResponse({ error: "Ce rendez-vous n'est plus annulable (déjà annulé ou terminé)." }, 409);
    if (_modif && (!Array.isArray(_updRows) || !_updRows.length)) return jsonResponse({ error: "Ce rendez-vous ne peut plus être modifié (annulé, terminé ou paiement en attente)." }, 409); // 2026-10-14
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
    // 2026-10-14 SECURITE : mot de passe obligatoire (vérifié par lx-profile, tentatives limitées)
    try {
      const pr = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/lx-profile`, { method: "POST", headers: { "Content-Type": "application/json", apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY }, body: JSON.stringify({ session_token: body.session_token, action: "check_password", password: String(body.password || "") }) });
      if (!pr.ok) { const pj = await pr.json().catch(() => ({})); return jsonResponse({ error: pj.error || "Mot de passe incorrect" }, pr.status === 429 ? 429 : 401); }
    } catch (_) { return jsonResponse({ error: "Vérification du mot de passe impossible, réessayez." }, 503); }
    const lxId = session.lx_id;
    // Fiches et réservations rattachées par email : seulement si l'email est vérifié (sinon un compte créé avec
    // l'adresse d'une autre personne pouvait anonymiser SES fiches chez les établissements).
    const email = lxEmailVerifie(session);
    const errors = [];
    // 0) 2026-10-14 audit : les rendez-vous À VENIR sont annulés (avant : ils restaient au planning de
    // l'établissement, anonymes, sans moyen de joindre le client). Acompte remboursé selon la politique
    // d'annulation de l'établissement (même traitement qu'une annulation par le client), empreinte libérée.
    let annules = 0;
    try {
      const _or = [lxId ? `client_luxyra_id.eq.${encodeURIComponent(lxId)}` : null, email ? `client_email.eq.${encodeURIComponent(email)}` : null].filter(Boolean).join(",");
      const _jour = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
      if (_or) {
        const lr = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rdv_online?select=*&or=(${_or})&status=in.(pending,pending_payment,confirmed)&date_rdv=gte.${_jour}&limit=200`, { headers: _sbHeaders(env) });
        const aVenir = lr.ok ? await lr.json() : [];
        for (const r0 of (Array.isArray(aVenir) ? aVenir : [])) {
          try {
            const debut = lxParisVersDate(r0.date_rdv, r0.heure_rdv || "23:59");
            if (isFinite(debut.getTime()) && debut.getTime() < Date.now()) continue; // déjà passé aujourd'hui
            const pr = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rdv_online?id=eq.${encodeURIComponent(r0.id)}&status=in.(pending,pending_payment,confirmed)`, {
              method: "PATCH", headers: _sbHeaders(env, { Prefer: "return=representation" }),
              body: JSON.stringify({ status: "cancelled", cancelled_at: new Date().toISOString(), cancelled_by: "client", cancel_reason: "Annulé suite à suppression du compte" })
            });
            const pa = pr.ok ? await pr.json() : [];
            const row = Array.isArray(pa) ? pa[0] : null;
            if (!row) continue;
            annules++;
            try { await refundAndRecord(env, row); } catch (e) { errors.push("remboursement " + r0.id + ": " + (e.message || e)); }
            try { await releaseEmpreinteOnCancel(env, row); } catch (e) { errors.push("empreinte " + r0.id + ": " + (e.message || e)); }
          } catch (e) { errors.push("annulation " + r0.id + ": " + (e.message || e)); }
        }
      }
    } catch (e) { errors.push("rdv a venir: " + (e.message || e)); }
    // Adresse du domicile et coordonnées effacées avec l'identité (comme purge_compte_client_inactif)
    const _anonRdv = { client_luxyra_id: null, client_nom: "Anonyme", client_prenom: "", client_tel: "", client_email: "", client_adresse: null, client_adresse_cp: null, client_adresse_ville: null, adresse_complement: null, client_lat: null, client_lng: null };
    // 1) Anonymise rdv_online par lx_id
    if (lxId) {
      try {
        const r = await fetch(
          `${CONFIG.SUPABASE_URL}/rest/v1/rdv_online?client_luxyra_id=eq.${encodeURIComponent(lxId)}`,
          { method: "PATCH", headers: _sbHeaders(env, { "Prefer": "return=minimal" }),
            body: JSON.stringify(_anonRdv) }
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
            body: JSON.stringify(_anonRdv) }
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
    return jsonResponse({ success: true, rdv_annules: annules, partial_errors: errors.length ? errors : null });
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
    // SECURITE 2026-10-08 : seule le client proprietaire du RDV (session) peut l'annuler ici.
    const session = await verifyClientSession(session_token, env);
    if (!session) return jsonResponse({ error: "Connectez-vous pour annuler ce rendez-vous" }, 401);
    const ownRes = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rdv_online?select=id,client_luxyra_id,client_email,salon_id,status,acompte_paye,acompte_montant,acompte_rembourse,acompte_rembourse_montant,remboursements,retenue_at,retenue_tk_num,cancelled_by,payment_intent_id,stripe_payment_id,stripe_account,date_rdv,heure_rdv,created_at,empreinte_status&id=eq.${encodeURIComponent(rdv_id)}&limit=1`, { headers: _sbHeaders(env) });
    const own = await ownRes.json();
    if (!Array.isArray(own) || !own[0]) return jsonResponse({ error: "RDV introuvable" }, 404);
    // 2026-10-14 SECURITE : rattachement par email seulement si l'email du compte est vérifié
    const owns = (own[0].client_luxyra_id && String(own[0].client_luxyra_id) === session.lx_id) ||
                 (!!lxEmailVerifie(session) && own[0].client_email && String(own[0].client_email).toLowerCase() === session.email);
    if (!owns) return jsonResponse({ error: "RDV non rattaché à votre compte" }, 403);
    // 2026-10-14 SECURITE : délai de la politique d'annulation vérifié côté serveur (avant : seulement dans l'interface)
    if (["pending", "confirmed"].includes(String(own[0].status || ""))) {
      const _refus = await lxControleAnnulationClient(env, own[0]);
      if (_refus) return jsonResponse({ error: _refus }, 409);
    }
    const patch = { status: "cancelled", cancel_reason: String(reason || "").slice(0, 500), cancelled_at: new Date().toISOString(), cancelled_by: "client" };
    // 2026-10-13 SECURITE : seulement un rendez-vous encore actif (voir handleClientRdvUpdate)
    const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rdv_online?id=eq.${encodeURIComponent(rdv_id)}&status=in.(pending,confirmed)`, {
      method: "PATCH",
      headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify(patch)
    });
    if (!res.ok) return jsonResponse({ error: "Update failed", status: res.status }, 500);
    const _rows = await res.json().catch(() => []);
    if (!Array.isArray(_rows) || !_rows.length) return jsonResponse({ error: "Ce rendez-vous n'est plus annulable (déjà annulé ou terminé)." }, 409);
    let refund = null;
    try { refund = await refundAndRecord(env, Object.assign({}, own[0], patch)); } catch (e) { console.error("refund on cancel:", e); }
    let empreinte = null;
    try { empreinte = await releaseEmpreinteOnCancel(env, Object.assign({}, own[0], patch)); } catch (e) { console.error("empreinte on cancel:", e); }
    return jsonResponse({ success: true, refund, empreinte });
  } catch (err) { return jsonResponse({ error: "Erreur serveur" }, 500); }
}

// ============================================================
// 2026-10-14 SECURITE (audit) — nouveaux points d'entrée
// ============================================================
// Empreinte d'adresse IP (jamais l'IP en clair) : HMAC-SHA256 avec la clé service comme sel secret.
async function lxIpHash(request, env) {
  const ip = String(request.headers.get("CF-Connecting-IP") || request.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  if (!ip) return null;
  try {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("lx-ip|" + String(env.SUPABASE_SERVICE_KEY || "")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ip));
    return Array.from(new Uint8Array(sig)).slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch (e) { return null; }
}
// 2026-10-15 : lxSha256Hex est défini plus haut (doublon issu de la fusion supprimé : il bloquait le déploiement)
async function lxRpcService(env, fn, args) {
  const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: { ..._sbHeaders(env), "Content-Type": "application/json" }, body: JSON.stringify(args || {}) });
  const t = await r.text();
  let d = null; try { d = t ? JSON.parse(t) : null; } catch (_) { d = t; }
  return { ok: r.ok, status: r.status, data: d };
}

// POST /api/client/salons {session_token, op:"list"|"lier", salon_id?}
// Remplace les accès anonymes à client_salon (points de fidélité affichés dans compte.html, lien créé par site.html).
async function handleClientSalons(request, env) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) return jsonResponse({ error: "body invalide" }, 400);
    const session = await verifyClientSession(body.session_token, env);
    if (!session) return jsonResponse({ error: "session_token invalide ou expiré" }, 401);
    const H = _sbHeaders(env), base = `${CONFIG.SUPABASE_URL}/rest/v1`, lx = encodeURIComponent(session.lx_id);
    if (String(body.op || "list") === "lier") {
      const sid = String(body.salon_id || "");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sid)) return jsonResponse({ error: "établissement invalide" }, 400);
      const sp = await (await fetch(`${base}/salons_public?id=eq.${sid}&select=id`, { headers: H })).json();
      if (!Array.isArray(sp) || !sp[0]) return jsonResponse({ error: "établissement introuvable" }, 404);
      const cl = await (await fetch(`${base}/clients_luxyra?id=eq.${lx}&select=sms_ok,email_ok`, { headers: H })).json();
      const c = Array.isArray(cl) && cl[0] ? cl[0] : {};
      // Colonnes minimales uniquement (jamais de points, notes, visites, CA…) ; rien n'est écrasé si le lien existe.
      await fetch(`${base}/client_salon?on_conflict=client_id,salon_id`, { method: "POST", headers: { ...H, "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify({ client_id: session.lx_id, salon_id: sid, sms_ok: c.sms_ok === true, email_ok: c.email_ok === true }) });
      return jsonResponse({ ok: true });
    }
    const rows = await (await fetch(`${base}/client_salon?client_id=eq.${lx}&select=salon_id,fidelite_points&limit=200`, { headers: H })).json();
    const list = Array.isArray(rows) ? rows : [];
    const ids = [...new Set(list.map((x) => x.salon_id).filter(Boolean))];
    const byId = {};
    if (ids.length) {
      const sp = await (await fetch(`${base}/salons_public?id=in.(${ids.join(",")})&select=id,nom,ville`, { headers: H })).json();
      (Array.isArray(sp) ? sp : []).forEach((x) => { byId[x.id] = x; });
    }
    return jsonResponse({ ok: true, salons: list.map((x) => ({ salon_id: x.salon_id, fidelite_points: x.fidelite_points || 0, salons: { nom: (byId[x.salon_id] || {}).nom || "", ville: (byId[x.salon_id] || {}).ville || "" } })) });
  } catch (e) { return jsonResponse({ error: "Erreur" }, 500); }
}

// POST /api/rdv/abandon {rdv_id, token}
// Supprime une réservation en attente de paiement abandonnée par le visiteur (retour « annuler » de Stripe, échec
// de création du paiement). Le navigateur prouve qu'il a créé la ligne avec le secret dont seule l'empreinte
// (abandon_hash) a été enregistrée à l'insertion. Jamais une réservation payée, confirmée ou de plus de 35 min.
async function handleRdvAbandon(request, env) {
  try {
    const ipk = (await lxIpHash(request, env)) || "?";
    if (!checkRateLimit("rdv_abandon:" + ipk, 20)) return jsonResponse({ error: "Trop de requêtes" }, 429);
    const b = await request.json().catch(() => ({}));
    const id = String(b.rdv_id || ""), tok = String(b.token || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || !/^[0-9a-f]{64}$/.test(tok)) return jsonResponse({ error: "paramètres invalides" }, 400);
    const h = await lxSha256Hex(tok);
    const depuis = new Date(Date.now() - 35 * 60 * 1000).toISOString();
    const q = `id=eq.${id}&abandon_hash=eq.${h}&status=eq.pending_payment&acompte_paye=is.false&payment_intent_id=is.null&stripe_payment_id=is.null&created_at=gte.${encodeURIComponent(depuis)}`;
    const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rdv_online?${q}`, { method: "DELETE", headers: { ..._sbHeaders(env), Prefer: "return=representation" } });
    const rows = r.ok ? await r.json().catch(() => []) : [];
    return jsonResponse({ ok: true, supprime: Array.isArray(rows) && rows.length > 0 });
  } catch (e) { return jsonResponse({ error: "Erreur" }, 500); }
}

// POST /api/inscription/email-check {email} — remplace l'appel anonyme à lx_email_deja_inscrit (limité par IP)
async function handleInscriptionEmailCheck(request, env) {
  const ipk = (await lxIpHash(request, env)) || "?";
  if (!checkRateLimit("email_check:" + ipk, 10)) return jsonResponse({ error: "Trop de vérifications, réessayez dans une minute." }, 429);
  const b = await request.json().catch(() => ({}));
  const email = String(b.email || "").trim().toLowerCase().slice(0, 200);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonResponse({ error: "Email invalide" }, 400);
  const r = await lxRpcService(env, "lx_email_deja_inscrit", { p_email: email });
  if (!r.ok) return jsonResponse({ error: "indisponible" }, 503);
  return jsonResponse({ existe: r.data === true });
}

// POST /api/annuaire/signaler {siret} — « établissement fermé » : signalement EN ATTENTE (masqué seulement après
// 3 signalements d'adresses IP différentes, ou validation par l'admin ; jamais un établissement Luxyra).
async function handleAnnuaireSignaler(request, env) {
  const ipk = await lxIpHash(request, env);
  if (!ipk) return jsonResponse({ ok: false }, 400);
  if (!checkRateLimit("ann_sig:" + ipk, 5)) return jsonResponse({ ok: false, error: "Trop de signalements" }, 429);
  const b = await request.json().catch(() => ({}));
  const siret = String(b.siret || "").replace(/\D/g, "");
  if (siret.length !== 14) return jsonResponse({ ok: false }, 400);
  const r = await lxRpcService(env, "annuaire_signaler", { p_siret: siret, p_ip_hash: ipk });
  return jsonResponse(r.ok && r.data ? r.data : { ok: false }, r.ok ? 200 : 503);
}

// POST /api/annuaire/retrait {siret, email, motif} — demande de retrait confirmée par email.
// Établissement lié à Luxyra : le lien part à l'adresse du GÉRANT (jamais à l'adresse saisie).
async function handleAnnuaireRetrait(request, env) {
  const ipk = await lxIpHash(request, env);
  if (!ipk) return jsonResponse({ ok: false, err: "Requête invalide" }, 400);
  if (!checkRateLimit("ann_ret:" + ipk, 3)) return jsonResponse({ ok: false, err: "Trop de demandes, réessayez plus tard." }, 429);
  const b = await request.json().catch(() => ({}));
  const siret = String(b.siret || "").replace(/\D/g, "");
  const email = String(b.email || "").trim().toLowerCase().slice(0, 120);
  if (siret.length !== 14) return jsonResponse({ ok: false, err: "Le SIRET doit contenir 14 chiffres." }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonResponse({ ok: false, err: "Indiquez une adresse email valide : un lien de confirmation y sera envoyé." }, 400);
  const r = await lxRpcService(env, "annuaire_retrait_demander", { p_siret: siret, p_email: email, p_motif: String(b.motif || "").slice(0, 300) || null, p_ip_hash: ipk });
  if (!r.ok || !r.data) return jsonResponse({ ok: false, err: "Service indisponible, réessayez." }, 503);
  const d = r.data;
  if (!d.ok) return jsonResponse({ ok: false, err: d.err || "Demande impossible." }, 400);
  if (d.token && d.email_dest) {
    const lien = `https://luxyra.fr/annuaire-retrait-confirmer?t=${d.token}`;
    const nom = String(d.nom || "").replace(/[&<>"]/g, (x) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[x]));
    const corps = `<p style="font-size:15px;color:#333;line-height:1.6">Une demande de retrait de l'annuaire Luxyra a été faite pour <b>${nom}</b> (SIRET ${siret}).</p>
<p style="font-size:15px;color:#333;line-height:1.6">${d.salon_lie ? "Cet établissement utilise Luxyra : ce message est envoyé à l'adresse du compte gérant. Confirmez seulement si vous êtes à l'origine de la demande." : "Confirmez la demande : elle sera ensuite vérifiée par notre équipe (sous 72 h)."}</p>
${lxMailBouton("Confirmer le retrait", lien)}
<p style="font-size:12px;color:#999;line-height:1.5">Lien valable 48 heures. Si vous n'êtes pas à l'origine de cette demande, ignorez cet email : rien ne sera modifié.</p>`;
    try { await brevoSendEmail(env, { to: d.email_dest, subject: "Confirmez le retrait de l'annuaire Luxyra", htmlContent: lxMailLayout(corps, { titre: "Retrait de l'annuaire" }), textContent: `Confirmer le retrait de ${d.nom || siret} de l'annuaire Luxyra (lien valable 48 h) : ${lien}` }); } catch (_) {}
  }
  // Réponse identique que l'établissement soit lié ou non (pas de divulgation de l'adresse du gérant)
  return jsonResponse({ ok: true, message: d.salon_lie ? "Un email de confirmation a été envoyé à l'adresse du gérant de l'établissement." : "Un email de confirmation vient de vous être envoyé." });
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

// 2026-10-14 audit : l'invitation crée désormais le COMPTE CLIENT Luxyra (clients_luxyra, par lx-signup — même
// chemin que l'inscription) et relie la fiche du salon (clients.client_luxyra_id). Avant : un utilisateur
// Supabase Auth (comptes des PROS) était créé, le client ne pouvait pas se connecter à son espace.
async function handleClientInviteVerify(request, env) {
  try {
    const { token, password } = await readJsonBody(request);
    if (!token) return jsonResponse({ error: "token requis" }, 400);
    if (!password || String(password).length < 8) return jsonResponse({ error: "Mot de passe : 8 caractères minimum" }, 400);

    // Charge l'invitation
    const inviteRes = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/client_invites?token=eq.${encodeURIComponent(token)}&select=*`, { headers: _sbHeaders(env) });
    const invites = inviteRes.ok ? await inviteRes.json() : [];
    if (!Array.isArray(invites) || !invites.length) return jsonResponse({ error: "Invitation introuvable ou expirée" }, 404);
    const invite = invites[0];
    if (invite.used_at) return jsonResponse({ error: "Cette invitation a déjà été utilisée. Connectez-vous avec votre mot de passe." }, 410);
    if (new Date(invite.expires_at) < new Date()) return jsonResponse({ error: "Cette invitation a expiré. Demandez-en une nouvelle au salon." }, 410);
    const email = String(invite.email || "").toLowerCase().trim();

    // Fiche du salon (pour le nom / prénom / téléphone / adresse du compte)
    let fiche = {};
    try {
      const fr = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/clients?id=eq.${encodeURIComponent(invite.client_id)}&salon_id=eq.${encodeURIComponent(invite.salon_id)}&select=id,nom,prenom,telephone,adresse,cp,ville,client_luxyra_id&limit=1`, { headers: _sbHeaders(env) });
      const fj = fr.ok ? await fr.json() : [];
      if (Array.isArray(fj) && fj[0]) fiche = fj[0];
    } catch (_) {}
    const lier = async (lxId) => {
      // Lien fiche salon <-> compte client (seulement si la fiche n'est pas déjà liée à un AUTRE compte)
      await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/clients?id=eq.${encodeURIComponent(invite.client_id)}&salon_id=eq.${encodeURIComponent(invite.salon_id)}&or=(client_luxyra_id.is.null,client_luxyra_id.eq.${encodeURIComponent(lxId)})`, {
        method: "PATCH", headers: _sbHeaders(env, { Prefer: "return=minimal" }), body: JSON.stringify({ client_luxyra_id: lxId })
      });
      try {
        await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/client_salon?on_conflict=client_id,salon_id`, {
          method: "POST", headers: _sbHeaders(env, { Prefer: "resolution=ignore-duplicates,return=minimal" }),
          body: JSON.stringify({ client_id: lxId, salon_id: invite.salon_id, premiere_visite: new Date().toISOString().slice(0, 10) })
        });
      } catch (_) {}
      await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/client_invites?token=eq.${encodeURIComponent(token)}&used_at=is.null`, {
        method: "PATCH", headers: _sbHeaders(env, { Prefer: "return=minimal" }), body: JSON.stringify({ used_at: new Date().toISOString() })
      });
    };

    // Compte client déjà existant -> jamais de changement de mot de passe ici ; la fiche est reliée
    // (le lien reçu par e-mail prouve que la personne contrôle cette adresse).
    const ex = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/clients_luxyra?select=id&email=eq.${encodeURIComponent(email)}&limit=1`, { headers: _sbHeaders(env) });
    const exa = ex.ok ? await ex.json() : [];
    if (Array.isArray(exa) && exa[0]) {
      await lier(exa[0].id);
      return jsonResponse({ error: "Un compte client existe déjà avec cet e-mail : votre fiche y est maintenant reliée. Connectez-vous, ou utilisez « Mot de passe oublié ».", compte_existant: true, email }, 409);
    }

    // Création du compte client par lx-signup (mêmes contrôles : 8 caractères, mot de passe divulgué, PBKDF2)
    const su = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/lx-signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY },
      body: JSON.stringify({ email, password: String(password), nom: String(fiche.nom || "").trim() || "Client", prenom: String(fiche.prenom || "").trim() || "-", telephone: fiche.telephone || null, adresse: fiche.adresse || null, cp: fiche.cp || null, ville: fiche.ville || null })
    });
    const sd = await su.json().catch(() => ({}));
    if (!su.ok || !sd || !sd.user || !sd.session_token) {
      if (su.status >= 500) console.error("invite lx-signup:", su.status, JSON.stringify(sd).slice(0, 300));
      return jsonResponse({ error: (sd && sd.error) || "Création du compte impossible" }, su.status >= 400 && su.status < 500 ? su.status : 500);
    }
    // L'invitation reçue par e-mail vaut vérification de l'adresse (comme le lien « mot de passe oublié »)
    try {
      await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/clients_luxyra?id=eq.${encodeURIComponent(sd.user.id)}`, { method: "PATCH", headers: _sbHeaders(env, { Prefer: "return=minimal" }), body: JSON.stringify({ email_verified: true }) });
      sd.user.email_verified = true;
    } catch (_) {}
    await lier(sd.user.id);
    return jsonResponse({ ok: true, email, user: sd.user, session_token: sd.session_token });
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
    const from = date_from || lxParisAujourdhui(); // 2026-10-14 : date de Paris
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
    // filtrer les pending_payment stales (paiement abandonné depuis > 35 min — 2026-10-14, avant 15 min).
    const roRes = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/rdv_online?select=date_rdv,heure_rdv,collaborateur_id,duree_minutes,status,created_at&salon_id=eq.${salon_id}&date_rdv=gte.${from}&status=neq.cancelled`,
      { headers }
    );
    const rdvOnlineBrut = await roRes.json();
    // 2026-10-14 : un paiement en cours (pending_payment) bloque le créneau 35 min (session Stripe = 31 min,
    // même délai que le déclencheur de la base). Au-delà : paiement abandonné, créneau libre.
    const _limPP = Date.now() - 35 * 60 * 1000;
    const rdvOnline = Array.isArray(rdvOnlineBrut)
      ? rdvOnlineBrut.filter((r) => !(r && r.status === "pending_payment" && r.created_at && new Date(r.created_at).getTime() < _limPP))
      : rdvOnlineBrut;
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
  regard:    { schema: "BeautySalon",  label: "Cils & sourcils",      noun: "Studio regard" },
  maquillage:{ schema: "BeautySalon",  label: "Maquillage",           noun: "Studio maquillage" },
  tatouage:  { schema: "TattooParlor", label: "Tatouage & piercing",  noun: "Studio de tatouage" },
  spa:       { schema: "DaySpa",       label: "Spa & massages",       noun: "Spa & massages" },
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

// ============================================================================
// ANNUAIRE PUBLIC « Métier à Ville » (2026-10-13, comme Planity) — v2 : design Luxyra, logo,
// et lien gérant orienté « activer la réservation » (le retrait reste possible, discrètement).
// /coiffeur/<ville>, /institut-de-beaute/<ville>, /spa-massage/<ville> (+ /coiffeur = villes)
// /annuaire-gerant?siret=… (page gérant), /annuaire-retrait (opposition, RPC annuaire_retirer)
// Établissements Luxyra en tête avec « Réserver » ; les autres viennent de la base publique Sirene
// (enseignes seulement, aucun nom de personne, aucune note inventée, aucun faux bouton de réservation).
// ============================================================================
const LX_ANN_LOGO = "data:image/webp;base64,UklGRigDAABXRUJQVlA4IBwDAACQDwCdASowADAAPlEij0WjoaETnASQOAUEsYBXJ605F9ePOejDbec73pwG84/6hxHu6q1dzC/+R9wHs1+hv+V/efgG/Vr/Z9eT9t/Yt/XlTKjrpPnVbcfCR8tAOR6dRsfqF3udzZAdGylkMu2pczclBrwDhuRUDlbkjXhfxbiQjs9IdEwgAP78pX/Fh/xQon4sa1CAyc1/ohBG4jmXYWWfjbcyo11jsoAEsbKeULzwh4FPpVJacD7br1LCiiTDp6xN56OfIpUJgCP+FWVUJOptF9MFJb8tE/3ifo4Ng0+lY/VlDL4D/TB2T4CbrArX9vFDoA8SUi/m517TEcmWSSbht5H+dTrB2o0es+G2o659GdTCDQNyr9Hh8vrb3Y6Cc6zsBIJZMqmmOLAm9+SJtf95P9+xYORz7ZuF8tvS94dtKJwJGMeX8OQXzRL0KFHATmXJUqnLKsq/v1Zf1kmomC9u7aTBJ/4O7vOnFN6wS2rvppGtBvfLZ/FtS03eYzgPGzOItPGsadUwy7fTb/FZEnSeVSH1zzIXIEq/8+S7Ccq2dHZ69n6L9OXHDU5ajWGModmSmmOJLh/aBVTZvjrBUfHG4B0cxIHE16Jy/o5+f+wQRxjDHFxSihTQKV4cl4Vb322dDJx61utw0XwrKdyfqVuW7nGFAECCSOFIpzrlhBKChYG2Vd9wgu58MRtO2nPzXO1PkMGAe+QaaBL1S71cD0zDIE3yhpFNwL+TMswCh6JWdmOur6ca76M1MH1a76WXsgpuEc7lPJi3+mziL0Dv52LSajdG/5teMdG2pP/5GsX1GyLUZK9NnA2iIGNVArxMbvXQ15D/UVozmLf0GPQ5ICgwSw5Iv76FLCxKVsgS8ARQG8E3hqqMSb7XYCoHuYkTlowqF0qTthXyq89GJ++pf7hud/OAcFnN3z5dNSSvK8XkfJdwyJKp9Pcsug48wzT+NiKadVrEIS2eKfhxhdS8bzoWPR96Ff4lh9zxrh2Q8iLrcjwyaE+NrgC+wprpy9eV3uy1L7nH2heVxDPHLS4Qou4afIINoUvdBbv7wAAA";
const LX_ANN_METIERS = {
  "coiffeur": { titre: "Coiffeur", pluriel: "Coiffeurs", luxyra: ["coiffure", "barbier"], metierLx: "coiffure", logiciel: "/logiciel-coiffure", schema: "HairSalon", phrase: "salons de coiffure et barbiers", icone: "✂️", presta: "une coupe, une couleur ou un brushing" },
  "institut-de-beaute": { titre: "Institut de beauté", pluriel: "Instituts de beauté", luxyra: ["esthetique", "ongles", "regard", "maquillage"], metierLx: "esthetique", logiciel: "/logiciel-institut-beaute", schema: "BeautySalon", phrase: "instituts de beauté, onglerie, cils et sourcils", icone: "💆", presta: "un soin du visage, une épilation ou une pose d'ongles" },
  "spa-massage": { titre: "Spa & massage", pluriel: "Spas & massages", luxyra: ["spa", "bien_etre"], metierLx: "spa", logiciel: "/logiciel-spa-massage", schema: "DaySpa", phrase: "spas, massages et bien-être", icone: "🌿", presta: "un massage ou un soin bien-être" },
  // Sous-métiers (même source Sirene, filtrée par l'enseigne) — 2026-10-13
  "onglerie": { source: "institut-de-beaute", motif: "ongl|nail|manucur|vernis", titre: "Onglerie", pluriel: "Ongleries", luxyra: ["ongles"], metierLx: "ongles", logiciel: "/logiciel-onglerie", schema: "NailSalon", phrase: "ongleries, prothésistes ongulaires et manucures", icone: "💅", presta: "une pose de gel, un semi-permanent ou une manucure" },
  "extension-de-cils": { source: "institut-de-beaute", motif: "cil|lash|regard|sourcil|brow", titre: "Extension de cils", pluriel: "Extensions de cils & sourcils", luxyra: ["regard"], metierLx: "regard", logiciel: "/logiciel-cils-sourcils", schema: "BeautySalon", phrase: "studios d'extensions de cils, rehaussement et sourcils", icone: "👁️", presta: "une pose de cils, un rehaussement ou des sourcils" },
  "barbier": { source: "coiffeur", motif: "barb", titre: "Barbier", pluriel: "Barbiers", luxyra: ["barbier"], metierLx: "barbier", logiciel: "/logiciel-barbier", schema: "BarberShop", phrase: "barbiers et barbershops", icone: "💈", presta: "une coupe homme ou une taille de barbe" },
};
function lxAnnSlug(s) { return String(s || "").replace(/œ/gi, "oe").replace(/æ/gi, "ae").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/['’]/g, "-").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
function lxAnnInit(n) { const m = String(n || "?").trim().match(/[A-Za-zÀ-ÿ0-9]/); return (m ? m[0] : "?").toUpperCase(); }
function lxAnnAdr(a) { return String(a || "").toLowerCase().replace(/(^|[\s\-'’])([a-zà-ÿ])/g, (_m, p, c) => p + c.toUpperCase()); }
async function lxAnnRpc(fn, args) {
  try {
    const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: CONFIG.SUPABASE_ANON_KEY, Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    return r.ok ? await r.json() : null;
  } catch (_) { return null; }
}
function lxAnnPage({ title, desc, canonical, robots, ld, body }) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${lxEsc(title)}</title><meta name="description" content="${lxEsc(desc)}">
${canonical ? `<link rel="canonical" href="${lxEsc(canonical)}">` : ""}<meta name="robots" content="${robots || "index,follow,max-snippet:-1,max-image-preview:large"}">
<meta property="og:type" content="website"><meta property="og:title" content="${lxEsc(title)}"><meta property="og:description" content="${lxEsc(desc)}"><meta property="og:site_name" content="Luxyra"><meta property="og:locale" content="fr_FR"><meta property="og:image" content="https://luxyra.fr/luxyra-logo.png">
${canonical ? `<meta property="og:url" content="${lxEsc(canonical)}">` : ""}<meta name="theme-color" content="#060609"><link rel="icon" href="/icon-192.png"><link rel="apple-touch-icon" href="/icon-192.png">
<link rel="stylesheet" href="https://luxyra.fr/fonts/luxyra-fonts.css">
${ld ? `<script type="application/ld+json">${lxJsonLd(ld)}</script>` : ""}
<style>
:root{--bg:#060609;--bg2:#0c0c12;--bg3:#14141e;--gold:#d4a843;--gold2:#b8960f;--gold-l:#e6c266;--text:#e8e4dc;--text2:#9a9590;--text3:#5c5854;--border:rgba(212,168,67,.14);--f1:'DM Sans',system-ui,-apple-system,'Segoe UI',sans-serif;--f2:'Cormorant Garamond',Georgia,serif}
*{margin:0;padding:0;box-sizing:border-box}body{background:var(--bg);color:var(--text);font-family:var(--f1);line-height:1.6}
a{color:var(--gold);text-decoration:none}a:hover{text-decoration:underline}
.nav{position:sticky;top:0;z-index:20;display:flex;align-items:center;justify-content:space-between;padding:12px 20px;background:rgba(6,6,9,.88);backdrop-filter:blur(12px);border-bottom:1px solid var(--border)}
.logo{display:flex;align-items:center;gap:10px;font-family:var(--f2);font-size:24px;font-weight:700;color:var(--gold);letter-spacing:1px;text-decoration:none!important}.logo img{width:34px;height:34px;border-radius:9px}
.nav .lk{display:flex;gap:18px;align-items:center;font-size:14px}.nav .lk a{color:var(--text2)}.nav .lk a.pro{color:#0a0a0a;background:linear-gradient(135deg,var(--gold),var(--gold2));padding:8px 16px;border-radius:30px;font-weight:700}
.hero{background:radial-gradient(1000px 380px at 50% -120px,rgba(212,168,67,.16),transparent 70%),linear-gradient(180deg,#0b0b12,var(--bg));border-bottom:1px solid var(--border)}
.wrap{max-width:1040px;margin:0 auto;padding:0 20px}.hero .wrap{padding-top:26px;padding-bottom:30px}
.fil{font-size:12.5px;color:var(--text3);margin-bottom:14px}.fil a{color:var(--text2)}
h1{font-family:var(--f2);font-weight:700;font-size:clamp(34px,5.4vw,54px);line-height:1.05;color:#fff;letter-spacing:-.5px}h1 em{font-style:normal;color:var(--gold)}
.sous{color:var(--text2);font-size:16px;margin-top:10px;max-width:640px}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}.chip{font-size:12.5px;border:1px solid var(--border);background:rgba(255,255,255,.03);color:var(--text);padding:6px 12px;border-radius:30px}.chip b{color:var(--gold)}
h2{font-family:var(--f2);font-weight:700;font-size:28px;color:#fff;margin:38px 0 14px}h2 small{font-family:var(--f1);font-size:13px;color:var(--text3);font-weight:400;margin-left:8px}
.carte{display:flex;gap:16px;align-items:center;background:linear-gradient(180deg,rgba(20,20,30,.9),rgba(14,14,20,.9));border:1px solid rgba(255,255,255,.06);border-radius:18px;padding:18px;margin:12px 0}
.carte.lx{border:1px solid rgba(212,168,67,.45);box-shadow:0 10px 40px -18px rgba(212,168,67,.35)}
.av{flex:0 0 54px;height:54px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-family:var(--f2);font-size:26px;font-weight:700;background:rgba(255,255,255,.05);color:var(--text2)}
.lx .av{background:linear-gradient(135deg,var(--gold),var(--gold2));color:#0a0a0a}
.ct{flex:1;min-width:0}.nm{font-size:17px;font-weight:700;color:#fff}.nm a{color:#fff}.ad{font-size:13.5px;color:var(--text2)}
.tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px}.tag{font-size:11.5px;padding:3px 9px;border-radius:20px;background:rgba(212,168,67,.1);color:var(--gold-l)}.tag.g{background:rgba(255,255,255,.05);color:var(--text3)}
.stars{color:var(--gold);font-size:13px;margin-left:4px}
.act{display:flex;flex-direction:column;gap:8px;align-items:flex-end}
.btn{display:inline-block;background:linear-gradient(135deg,var(--gold),var(--gold2));color:#0a0a0a!important;font-weight:800;padding:11px 22px;border-radius:30px;font-size:14px;white-space:nowrap;text-decoration:none!important}
.btn2{font-size:12.5px;color:var(--text2)}
.claim{font-size:12.5px;color:var(--gold-l);white-space:nowrap}
.atouts{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.at{background:var(--bg2);border:1px solid var(--border);border-radius:16px;padding:18px}.at b{display:block;color:#fff;margin:6px 0 4px}.at span{font-size:13.5px;color:var(--text2)}.at i{font-style:normal;font-size:22px}
.faq details{background:var(--bg2);border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:14px 16px;margin:8px 0}.faq summary{cursor:pointer;color:#fff;font-weight:600}.faq p{color:var(--text2);font-size:14.5px;margin-top:8px}
.bande{margin:40px 0 10px;padding:26px;border-radius:20px;background:linear-gradient(135deg,rgba(212,168,67,.16),rgba(212,168,67,.04));border:1px solid rgba(212,168,67,.35);display:flex;gap:18px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.bande b{font-family:var(--f2);font-size:24px;color:#fff;display:block}.bande span{color:var(--text2);font-size:14px}
.villes{columns:3;column-gap:22px;font-size:14px}.villes a{display:block;color:var(--text);padding:4px 0}.villes span{color:var(--text3);font-size:12px}
.src{font-size:11.5px;color:var(--text3);margin:30px 0 0;line-height:1.6}
footer{border-top:1px solid var(--border);margin-top:40px;padding:26px 20px;text-align:center;font-size:12.5px;color:var(--text3)}footer a{color:var(--text2);margin:0 6px}
@media(max-width:720px){.nav .lk a:not(.pro){display:none}.carte{flex-wrap:wrap}.act{width:100%;flex-direction:column;align-items:stretch;gap:10px}.act .claim{white-space:normal;display:block;text-align:center;padding:10px 12px;border:1px solid rgba(212,168,67,.4);border-radius:12px}.act .btn{text-align:center}.act .btn2{text-align:center;white-space:normal}.atouts{grid-template-columns:1fr}.villes{columns:2}}
</style></head><body>
<div class="nav"><a class="logo" href="/"><img src="${LX_ANN_LOGO}" width="34" height="34" alt="Luxyra"> Luxyra</a><div class="lk"><a href="/recherche">Trouver un pro</a><a href="/coiffeur">Coiffeurs</a><a href="/institut-de-beaute">Instituts</a><a href="/onglerie">Ongles</a><a href="/extension-de-cils">Cils</a><a class="pro" href="/pro">Je suis un pro</a></div></div>
${body}
<footer><a class="logo" href="/" style="justify-content:center;font-size:20px;margin-bottom:10px"><img src="${LX_ANN_LOGO}" width="28" height="28" alt="Luxyra"> Luxyra</a>
<div><a href="/recherche">Trouver un pro</a>·<a href="/pro">Espace pro</a>·<a href="/tarifs">Tarifs</a>·<a href="/mentions-legales">Mentions légales</a>·<a href="/politique-confidentialite">Confidentialité</a></div>
<div style="margin-top:8px">© Luxyra — réservation en ligne et caisse pour les professionnels de la beauté et du bien-être</div></footer>
</body></html>`;
}
function lxAnnReponse(html, status) {
  return new Response(html, { status: status || 200, headers: { "Content-Type": "text/html;charset=UTF-8", "Cache-Control": "public, max-age=600" } });
}
function lxAnnEtoiles(n) { const v = Math.round(Number(n) || 0); return "★★★★★".slice(0, v) + "☆☆☆☆☆".slice(0, 5 - v); }

// 2026-10-14 audit : engagements affichés pour UN établissement, d'après ses réglages réels
// (site_config.confirmation_auto, politique_annulation lue par lxPolitiqueHeures ; domicile = toujours validé par le pro).
function lxAnnEngagements(cfg, salon) {
  cfg = cfg || {};
  const domicile = String((salon && salon.mode_activite) || "") === "domicile";
  const immediate = cfg.confirmation_auto === true && !domicile;
  const h = lxPolitiqueHeures(cfg.politique_annulation);
  const tags = [immediate ? "Confirmation immédiate" : "Confirmation par l'établissement"];
  if (h === 0) tags.push("Annulation en ligne");
  else if (h > 0) tags.push(`Annulation en ligne jusqu'à ${h >= 24 && h % 24 === 0 ? (h / 24) + (h / 24 > 1 ? " jours" : " jour") : h + " h"} avant`);
  const phrase = immediate ? "Confirmation immédiate par e-mail." : "Votre demande est confirmée par l'établissement ; vous êtes prévenu par e-mail.";
  return { immediate, tags, phrase };
}
async function lxAnnuairePage(metierSlug, villeSlug) {
  const M = LX_ANN_METIERS[metierSlug];
  if (!M) return null;
  // ---- Liste des villes ----
  if (!villeSlug) {
    const villes = (await lxAnnRpc("annuaire_villes2", { p_source: M.source || metierSlug, p_motif: M.motif || null, p_lx: M.luxyra })) || [];
    const parDep = {};
    for (const v of villes) { (parDep[v.departement] = parDep[v.departement] || []).push(v); }
    let body = `<section class="hero"><div class="wrap"><div class="fil"><a href="/">Accueil</a> › ${lxEsc(M.pluriel)}</div><h1>${lxEsc(M.pluriel)} <em>près de chez vous</em></h1><p class="sous">Trouvez des ${lxEsc(M.phrase)} dans votre ville et réservez en ligne, 24 h/24, chez les établissements Luxyra.</p></div></section><div class="wrap">`;
    for (const dep of Object.keys(parDep).sort()) {
      body += `<h2>Département ${lxEsc(dep)}</h2><div class="villes">` + parDep[dep].map((v) => `<a href="/${metierSlug}/${lxEsc(v.ville_slug)}">${lxEsc(M.titre)} à ${lxEsc(v.ville)} <span>(${v.n})</span></a>`).join("") + `</div>`;
    }
    if (!villes.length) body += `<p class="sous" style="margin-top:30px">La liste est en cours de préparation.</p>`;
    body += `</div>`;
    return lxAnnReponse(lxAnnPage({ title: `${M.pluriel} : trouvez un professionnel et réservez en ligne | Luxyra`, desc: `${M.pluriel} par ville : adresses, avis et réservation en ligne 24 h/24 chez les établissements Luxyra.`, canonical: `https://luxyra.fr/${metierSlug}`, robots: villes.length ? null : "noindex,follow", body }), villes.length ? 200 : 404);
  }
  // ---- Page d'une ville ----
  const etabs = (await lxAnnRpc("annuaire_ville2", { p_source: M.source || metierSlug, p_ville_slug: villeSlug, p_motif: M.motif || null })) || [];
  const lx = [];
  try {
    const rows = await lxSeoFetch(`salons_public?or=(metier.in.(${M.luxyra.join(",")}),metiers_autres.ov.{${M.luxyra.join(",")}})&select=id,nom,slug,adresse,cp,ville,note_moyenne,nb_avis,mode_activite,sous_titre&limit=500`); // 2026-10-13 : métiers secondaires inclus
    // 2026-10-13 : site désactivé par l'établissement -> absent de l'annuaire
    let off = new Set();
    try { off = new Set(((await lxSeoFetch(`site_config?site_actif=eq.false&select=salon_id&limit=1000`)) || []).map((x) => x.salon_id)); } catch (_) {}
    for (const s of (rows || [])) if (s.slug && !off.has(s.id) && lxAnnSlug(s.ville) === villeSlug) lx.push(s);
    // 2026-10-14 audit : réglages réels de chaque établissement (confirmation automatique, annulation en ligne)
    if (lx.length) {
      try {
        const cf = (await lxSeoFetch(`site_config?salon_id=in.(${lx.map((x) => x.id).join(",")})&select=salon_id,confirmation_auto,politique_annulation&limit=500`)) || [];
        const parId = {}; for (const c of cf) parId[c.salon_id] = c;
        for (const x of lx) x._cfg = parId[x.id] || {};
      } catch (_) {}
    }
  } catch (_) {}
  const lxIds = new Set(lx.map((s) => s.id));
  const autres = etabs.filter((e) => !e.salon_id || !lxIds.has(e.salon_id));
  const total = lx.length + autres.length;
  const villeNom = (etabs[0] && etabs[0].ville) || (lx[0] && lx[0].ville) || villeSlug.replace(/-/g, " ");
  const dep = (etabs[0] && etabs[0].departement) || (lx[0] && String(lx[0].cp || "").slice(0, 2)) || "";
  if (!total) {
    return lxAnnReponse(lxAnnPage({ title: `${M.titre} à ${villeNom} | Luxyra`, desc: "", robots: "noindex,follow", body: `<section class="hero"><div class="wrap"><h1>${lxEsc(M.titre)} à <em>${lxEsc(villeNom)}</em></h1><p class="sous">Aucun établissement trouvé pour cette ville. <a href="/${metierSlug}">Voir toutes les villes</a>.</p></div></section>` }), 404);
  }
  const canonical = `https://luxyra.fr/${metierSlug}/${villeSlug}`;
  let body = `<section class="hero"><div class="wrap"><div class="fil"><a href="/">Accueil</a> › <a href="/${metierSlug}">${lxEsc(M.pluriel)}</a> › ${lxEsc(villeNom)}</div>`;
  body += `<h1>${lxEsc(M.titre)} à <em>${lxEsc(villeNom)}</em></h1>`;
  body += `<p class="sous">Comparez les ${lxEsc(M.phrase)} de ${lxEsc(villeNom)}${lx.length ? " et prenez rendez-vous en ligne en quelques secondes" : ""}.</p>`;
  body += `<div class="chips"><span class="chip"><b>${total}</b> établissement${total > 1 ? "s" : ""}</span>${lx.length ? `<span class="chip"><b>${lx.length}</b> réservable${lx.length > 1 ? "s" : ""} en ligne</span>${lx.every((x) => lxAnnEngagements(x._cfg, x).immediate) ? `<span class="chip">Confirmation immédiate</span>` : ""}<span class="chip">Sans frais pour vous</span>` : ""}</div></div></section><div class="wrap">`;
  if (lx.length) {
    body += `<h2>Réserver en ligne <small>disponibles 24 h/24</small></h2>`;
    for (const s of lx) {
      const note = Number(s.note_moyenne) > 0 && Number(s.nb_avis) > 0 ? `<span class="stars">${lxAnnEtoiles(s.note_moyenne)}</span> <span style="font-size:12.5px;color:var(--text2)">${Number(s.note_moyenne).toFixed(1).replace(".", ",")} · ${s.nb_avis} avis</span>` : "";
      const adr = String(s.mode_activite || "") === "domicile" ? `À domicile · ${lxEsc(s.ville || villeNom)}` : lxEsc(lxAnnAdr([s.adresse, s.cp, s.ville].filter(Boolean).join(" ")));
      body += `<div class="carte lx"><div class="av">${lxEsc(lxAnnInit(s.nom))}</div><div class="ct"><div class="nm"><a href="/${lxEsc(s.slug)}">${lxEsc(s.nom)}</a> ${note}</div><div class="ad">${adr}</div><div class="tags"><span class="tag">Réservation 24 h/24</span>${lxAnnEngagements(s._cfg, s).tags.map((t) => `<span class="tag">${lxEsc(t)}</span>`).join("")}</div></div><div class="act"><a class="btn" href="/${lxEsc(s.slug)}/reserver">Réserver</a><a class="btn2" href="/${lxEsc(s.slug)}">Voir le salon</a></div></div>`;
    }
  }
  if (autres.length) {
    body += `<h2>${lxEsc(lx.length ? "Autres établissements" : M.pluriel)} à ${lxEsc(villeNom)}</h2>`;
    for (const e of autres) {
      const q = `siret=${encodeURIComponent(e.siret)}`;
      body += `<div class="carte"><div class="av">${lxEsc(lxAnnInit(e.nom))}</div><div class="ct"><div class="nm">${lxEsc(e.nom)}</div><div class="ad">${lxEsc(lxAnnAdr([e.adresse, e.cp, e.ville].filter(Boolean).join(" ")))}</div><div class="tags"><span class="tag g">Réservation en ligne pas encore disponible</span></div></div><div class="act"><a class="claim" href="/annuaire-gerant?${q}" rel="nofollow">C'est votre établissement ? Activez la réservation →</a><a href="#" class="btn2" style="font-size:11.5px;color:var(--text3)" onclick="lxFerme(this,'${lxEsc(e.siret)}');return false;" rel="nofollow">Établissement fermé ? Le signaler</a></div></div>`;
    }
  }
  body += `<h2>Pourquoi réserver avec Luxyra</h2><div class="atouts"><div class="at"><i>⏱</i><b>En quelques secondes</b><span>Choisissez la prestation et l'horaire, 24 h/24, même quand le salon est fermé.</span></div><div class="at"><i>🔔</i><b>Confirmation par e-mail</b><span>Vous êtes prévenu dès que le rendez-vous est confirmé (tout de suite ou après validation par l'établissement, selon ses réglages), et un rappel arrive avant le rendez-vous si l'établissement l'a activé.</span></div><div class="at"><i>📱</i><b>Tout au même endroit</b><span>Retrouvez vos rendez-vous depuis votre espace ou l'application, et annulez-les en ligne quand l'établissement le permet.</span></div></div>`;
  const faq = [
    [`Comment prendre rendez-vous chez un ${M.titre.toLowerCase()} à ${villeNom} ?`, lx.length ? `Choisissez un établissement marqué « Luxyra » ci-dessus et cliquez sur « Réserver » : vous voyez les disponibilités en temps réel et recevez la confirmation par e-mail (immédiate ou après validation par l'établissement, selon ses réglages).` : `Les établissements listés ci-dessus ne proposent pas encore la réservation en ligne sur Luxyra : contactez-les directement. Dès qu'un établissement l'active, un bouton « Réserver » apparaît sur cette page.`],
    [`Combien d'établissements à ${villeNom} ?`, `${total} établissement${total > 1 ? "s" : ""} ${total > 1 ? "sont référencés" : "est référencé"} à ${villeNom}, dont ${lx.length} réservable${lx.length > 1 ? "s" : ""} en ligne.`],
    [`La réservation en ligne est-elle payante ?`, `Non, réserver sur Luxyra est gratuit pour vous. Certains établissements demandent un acompte, indiqué clairement avant la confirmation.`],
  ];
  body += `<h2>Questions fréquentes</h2><div class="faq">` + faq.map(([q, r]) => `<details><summary>${lxEsc(q)}</summary><p>${lxEsc(r)}</p></details>`).join("") + `</div>`;
  body += `<div class="bande"><div><b>Vous êtes ${M.titre === "Coiffeur" ? "coiffeur" : "professionnel"} à ${lxEsc(villeNom)} ?</b><span>Apparaissez en tête de cette page avec un bouton « Réserver ». Réservation en ligne sans commission, rappels SMS, caisse conforme. Essai gratuit 14 jours.</span></div><a class="btn" href="${M.logiciel}">Découvrir Luxyra</a></div>`;
  try {
    const villes = ((await lxAnnRpc("annuaire_villes2", { p_source: M.source || metierSlug, p_motif: M.motif || null, p_lx: M.luxyra })) || []).filter((v) => v.departement === dep && v.ville_slug !== villeSlug).slice(0, 30);
    if (villes.length) body += `<h2>${lxEsc(M.pluriel)} dans les villes proches</h2><div class="villes">` + villes.map((v) => `<a href="/${metierSlug}/${lxEsc(v.ville_slug)}">${lxEsc(M.titre)} à ${lxEsc(v.ville)} <span>(${v.n})</span></a>`).join("") + `</div>`;
  } catch (_) {}
  body += `<script>async function lxFerme(el,siret){if(!confirm("Cet établissement est fermé ? Votre signalement sera vérifié avant tout retrait.")) return false;try{var r=await fetch('/api/annuaire/signaler',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({siret:siret})});var d=await r.json();if(d&&d.ok){el.textContent=d.masque?"Merci, c’est noté : retiré de la liste.":"Merci, c’est noté : nous allons vérifier.";el.onclick=function(){return false;};var c=el.closest('.carte');if(d.masque&&c)c.style.opacity='.35';}}catch(e){}return false;}</script>`;
  body += `<p class="src">Liste établie à partir des établissements inscrits sur Luxyra et de la base publique des entreprises (Sirene, INSEE — données ouvertes), mise à jour chaque mois. Seuls les établissements en activité, à diffusion publique et disposant d'une enseigne sont affichés.</p></div>`;
  const items = [...lx.map((s) => ({ "@type": M.schema, name: s.nom, url: `https://luxyra.fr/${s.slug}`, address: { "@type": "PostalAddress", streetAddress: String(s.mode_activite || "") === "domicile" ? "" : (s.adresse || ""), postalCode: s.cp || "", addressLocality: s.ville || villeNom, addressCountry: "FR" } })),
    ...autres.map((e) => ({ "@type": M.schema, name: e.nom, address: { "@type": "PostalAddress", streetAddress: e.adresse || "", postalCode: e.cp || "", addressLocality: e.ville, addressCountry: "FR" } }))];
  const ld = { "@context": "https://schema.org", "@graph": [
    { "@type": "BreadcrumbList", itemListElement: [ { "@type": "ListItem", position: 1, name: "Accueil", item: "https://luxyra.fr/" }, { "@type": "ListItem", position: 2, name: M.pluriel, item: `https://luxyra.fr/${metierSlug}` }, { "@type": "ListItem", position: 3, name: villeNom, item: canonical } ] },
    { "@type": "ItemList", name: `${M.titre} à ${villeNom}`, numberOfItems: items.length, itemListElement: items.slice(0, 100).map((it, i) => ({ "@type": "ListItem", position: i + 1, item: it })) },
    { "@type": "FAQPage", mainEntity: faq.map(([q, r]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: r } })) } ] };
  const title = `${M.titre} à ${villeNom}${lx.length ? " : réserver en ligne" : ""} (${total} adresse${total > 1 ? "s" : ""}) | Luxyra`;
  const desc = `${M.titre} à ${villeNom}${dep ? " (" + dep + ")" : ""} : ${total} établissement${total > 1 ? "s" : ""}${lx.length ? `, dont ${lx.length} réservable${lx.length > 1 ? "s" : ""} en ligne 24 h/24 avec confirmation immédiate` : ""}. Adresses et prise de rendez-vous sur Luxyra.`;
  return lxAnnReponse(lxAnnPage({ title, desc, canonical, ld, body }));
}

// Page « C'est votre établissement ? » : d'abord activer la réservation ; le retrait reste possible en bas.
async function lxAnnuaireGerantPage(url) {
  const siret = String(url.searchParams.get("siret") || "").replace(/\D/g, "").slice(0, 14);
  const f = siret.length === 14 ? (((await lxAnnRpc("annuaire_fiche", { p_siret: siret })) || [])[0] || null) : null;
  const M = (f && LX_ANN_METIERS[f.metier]) || LX_ANN_METIERS["coiffeur"];
  const nom = f ? f.nom : "votre établissement";
  const insc = `/inscription?siret=${encodeURIComponent(siret)}${f ? `&nom=${encodeURIComponent(f.nom)}&metier=${M.metierLx}` : ""}`;
  let body = `<section class="hero"><div class="wrap">${f ? `<div class="fil"><a href="/${f.metier}/${lxEsc(f.ville_slug)}">← ${lxEsc(M.titre)} à ${lxEsc(f.ville)}</a></div>` : ""}`;
  body += `<h1>Activez la réservation en ligne pour <em>${lxEsc(nom)}</em></h1>`;
  body += `<p class="sous">Vos clients vous cherchent sur Google et sur Luxyra. Avec Luxyra, ils réservent en ligne 24 h/24 et votre établissement passe en tête de la page${f ? ` « ${lxEsc(M.titre)} à ${lxEsc(f.ville)} »` : ""}, avec un bouton « Réserver ».</p>`;
  body += `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:22px"><a class="btn" href="${insc}">Essayer gratuitement 14 jours</a><a class="btn" style="background:transparent;color:var(--gold)!important;border:1px solid rgba(212,168,67,.5)" href="/demo">Voir la démo</a></div>`;
  body += `<div class="chips"><span class="chip">Sans carte bancaire</span><span class="chip">Sans commission sur vos réservations</span><span class="chip">Dès <b>14,99 €</b>/mois</span><span class="chip">Sans engagement</span></div></div></section><div class="wrap">`;
  body += `<h2>Tout ce qu'il faut à votre établissement</h2><div class="atouts">
<div class="at"><i>📅</i><b>Réservation en ligne</b><span>Vos clients réservent 24 h/24 sur votre page, sur Google et dans l'application Luxyra. Acompte ou empreinte bancaire possibles.</span></div>
<div class="at"><i>🔔</i><b>Moins de rendez-vous oubliés</b><span>Confirmation immédiate et rappels automatiques par SMS et e-mail.</span></div>
<div class="at"><i>🧾</i><b>Caisse conforme</b><span>Caisse conforme à la loi anti-fraude TVA, clôtures, fidélité, bons cadeaux, statistiques.</span></div>
<div class="at"><i>⭐</i><b>Avis clients</b><span>Une invitation à laisser un avis après chaque rendez-vous, affichée sur votre page.</span></div>
<div class="at"><i>🌐</i><b>Votre site inclus</b><span>Une page à votre nom, prête pour Google, avec vos prestations, horaires et photos.</span></div>
<div class="at"><i>🤝</i><b>On vous aide</b><span>Migration gratuite de vos données et assistance en français. Écrivez-nous : <a href="mailto:contact@luxyra.fr">contact@luxyra.fr</a>.</span></div></div>`;
  body += `<div class="bande"><div><b>Prêt en quelques minutes</b><span>Créez votre espace, ajoutez vos prestations et vos horaires : la réservation est en ligne immédiatement.</span></div><a class="btn" href="${insc}">Commencer gratuitement</a></div>`;
  body += `<p class="src" style="margin-top:40px">Votre établissement apparaît dans l'annuaire Luxyra à partir de la base publique des entreprises (Sirene). Vous ne souhaitez pas y figurer ? <a href="/annuaire-retrait${siret ? "?siret=" + siret : ""}" rel="nofollow" style="color:var(--text2);text-decoration:underline">Retirer cet établissement de l'annuaire</a>.</p></div>`;
  return lxAnnReponse(lxAnnPage({ title: `Activer la réservation en ligne pour ${nom} | Luxyra`, desc: `Activez la réservation en ligne pour ${nom} : réservation 24 h/24, rappels SMS, caisse conforme, sans commission. Essai gratuit 14 jours.`, robots: "noindex,follow", body }));
}

function lxAnnuaireRetraitPage(url) {
  const siret = String(url.searchParams.get("siret") || "").replace(/\D/g, "").slice(0, 14);
  const body = `<section class="hero"><div class="wrap"><h1>Retirer un établissement <em>de l'annuaire</em></h1>
<p class="sous">Les pages « Coiffeur à … », « Institut de beauté à … » présentent les établissements en activité d'après la base publique des entreprises (Sirene). Vous êtes le gérant et ne souhaitez pas apparaître ? Indiquez le SIRET de l'établissement (14 chiffres) et votre email : vous recevrez un lien de confirmation, puis la demande est vérifiée par notre équipe (sous 72 h).</p></div></section>
<div class="wrap"><div class="carte" style="display:block;margin-top:26px"><label style="font-size:13px;color:var(--text2)">SIRET de l'établissement</label><br><input id="s" inputmode="numeric" maxlength="14" value="${lxEsc(siret)}" style="width:100%;max-width:340px;padding:11px;border-radius:10px;border:1px solid #2a2a35;background:#0b0b10;color:#fff;font-size:16px;margin:6px 0 12px"><br>
<label style="font-size:13px;color:var(--text2)">E-mail (obligatoire, pour confirmer la demande)</label><br><input id="e" type="email" maxlength="120" style="width:100%;max-width:340px;padding:11px;border-radius:10px;border:1px solid #2a2a35;background:#0b0b10;color:#fff;font-size:15px;margin:6px 0 14px"><br>
<button class="btn" style="border:none;cursor:pointer" onclick="lxRet()">Retirer cet établissement</button><div id="m" style="margin-top:12px;font-size:14px"></div></div>
<p class="sous" style="margin-top:18px">Vous préférez que vos clients puissent réserver en ligne ? <a href="/annuaire-gerant${siret ? "?siret=" + siret : ""}">Activez la réservation gratuitement</a>.</p></div>
<script>async function lxRet(){var s=document.getElementById('s').value.replace(/\\D/g,''),m=document.getElementById('m');if(s.length!==14){m.textContent='Le SIRET doit contenir 14 chiffres.';m.style.color='#f87171';return;}
try{var r=await fetch('/api/annuaire/retrait',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({siret:s,email:document.getElementById('e').value||''})});var d=await r.json();
if(d&&d.ok){m.textContent='✅ '+(d.message||'Un email de confirmation a été envoyé.');m.style.color='#7fc97f';}else{m.textContent=(d&&d.err)||'Erreur, réessayez.';m.style.color='#f87171';}}catch(e){m.textContent='Erreur réseau, réessayez.';m.style.color='#f87171';}}</script>`;
  return lxAnnReponse(lxAnnPage({ title: "Retirer un établissement de l'annuaire | Luxyra", desc: "Demander le retrait d'un établissement des pages annuaire de Luxyra.", robots: "noindex,follow", body }));
}

// 2026-10-14 : lien reçu par email -> confirmation de la demande de retrait (RPC service annuaire_retrait_confirmer)
async function lxAnnuaireRetraitConfirmerPage(url, env) {
  const t = String(url.searchParams.get("t") || "");
  let msg = "Lien invalide ou expiré.";
  if (/^[0-9a-f]{64}$/.test(t)) {
    try {
      const r = await lxRpcService(env, "annuaire_retrait_confirmer", { p_token: t });
      if (r.ok && r.data && r.data.ok) msg = r.data.masque ? "✅ C'est confirmé : l'établissement n'apparaît plus dans l'annuaire (mise à jour des pages sous quelques minutes)." : "✅ Demande confirmée : elle sera vérifiée par notre équipe sous 72 h.";
      else if (r.ok && r.data && r.data.err) msg = r.data.err;
    } catch (_) { msg = "Service indisponible, réessayez."; }
  }
  const body = `<section class="hero"><div class="wrap"><h1>Retrait <em>de l'annuaire</em></h1><p class="sous">${lxEsc(msg)}</p></div></section>`;
  return lxAnnReponse(lxAnnPage({ title: "Retrait de l'annuaire | Luxyra", desc: "Confirmation de retrait de l'annuaire Luxyra.", robots: "noindex,nofollow", body }));
}

// Renvoie { head, body } ou null. NE JETTE JAMAIS.
async function lxBuildSalonSeo(slug, reserverIntent) {
  try {
    const rows = await lxSeoFetch(
      `salons_public?slug=eq.${encodeURIComponent(slug)}` +
      `&select=id,nom,sous_titre,metier,mode_activite,adresse,cp,ville,tel,email,logo,site_web,latitude,longitude,note_moyenne,nb_avis&limit=1`
    );
    if (!Array.isArray(rows)) return null;          // erreur / délai : page normale, rien de plus
    if (!rows[0]) {                                  // 2026-10-12 : adresse inconnue ou établissement fermé
      // ancienne adresse d'un salon renommé -> redirection permanente vers la nouvelle
      const al = await lxSeoFetch(`salon_slug_aliases?slug=eq.${encodeURIComponent(slug)}&select=salon_id&limit=1`);
      if (Array.isArray(al) && al[0] && al[0].salon_id) {
        const cur = await lxSeoFetch(`salons_public?id=eq.${encodeURIComponent(al[0].salon_id)}&select=slug&limit=1`);
        if (Array.isArray(cur) && cur[0] && cur[0].slug && cur[0].slug !== slug) return { notFound: true, redirect: cur[0].slug };
      }
      return { notFound: true };
    }
    const s = rows[0];

    const [cfgRows, svcRows] = await Promise.all([
      lxSeoFetch(
        `site_config?salon_id=eq.${encodeURIComponent(s.id)}` +
        `&select=horaires_salon,description_salon,slogan,site_actif,reservation_active,photo_hero,confirmation_auto,politique_annulation&limit=1`
      ),
      lxSeoFetch(
        `services?salon_id=eq.${encodeURIComponent(s.id)}&actif=eq.true&show_site=eq.true` +
        // 2026-10-15 : select=* -> prix_sur_devis / prix_a_partir_de lus s'ils existent (aucune erreur avant le SQL apartir.sql)
        `&select=*&order=ordre.asc.nullslast,nom.asc&limit=60`
      ),
    ]);
    const cfg = (Array.isArray(cfgRows) && cfgRows[0]) ? cfgRows[0] : {};

    // Site explicitement desactive par le salon => on n'indexe rien.
    if (cfg.site_actif === false) return { notFound: true };

    const services = Array.isArray(svcRows) ? svcRows : [];
    const m = LX_METIER[s.metier] || LX_SEO_FALLBACK_METIER;

    const nom = s.nom || "Salon";
    const sousTitre = s.sous_titre || "";
    const ville = s.ville || "";
    const cp = s.cp || "";
    // 2026-10-10 : pro 100 % à domicile -> adresse personnelle et position exacte jamais publiées
    const _domicileSeul = String(s.mode_activite || "").toLowerCase() === "domicile";
    const adresse = _domicileSeul ? "" : (s.adresse || "");
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
      // 2026-10-15 : « sur devis » = aucun prix publié ; « à partir de » = prix minimum (priceSpecification.minPrice)
      const devis = sv.prix_sur_devis === true;
      const apartir = !devis && sv.prix_a_partir_de === true;
      if (!devis) {
        if (prix < minP) minP = prix;
        if (prix > maxP) maxP = prix;
      }
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
      const offer = {
        "@type": "Offer",
        itemOffered: item,
        availability: "https://schema.org/InStock",
        url: `${canonical}#reserver`,
      };
      if (devis) {
        offer.description = "Prix sur devis";
      } else if (apartir) {
        offer.priceCurrency = "EUR";
        offer.priceSpecification = { "@type": "PriceSpecification", minPrice: prix.toFixed(2), priceCurrency: "EUR" };
        offer.description = `À partir de ${prix.toFixed(2).replace(".", ",")} €`;
      } else {
        offer.price = prix.toFixed(2);
        offer.priceCurrency = "EUR";
      }
      offers.push(offer);
      const prixTxt = devis ? "Sur devis" : `${apartir ? "à partir de " : ""}${prix.toFixed(2).replace(".", ",")} €`;
      svcRowsHtml.push(
        `<li>${lxEsc(sv.nom)}${sv.categorie ? ` <em>(${lxEsc(sv.categorie)})</em>` : ""} — <strong>${prixTxt}</strong>${dureeMin > 0 ? ` · ${dureeMin} min` : ""}</li>`
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
    if (!_domicileSeul && s.latitude != null && s.longitude != null) {
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
    // 2026-10-14 audit : promesses tirées des réglages de l'établissement (avant : « Confirmation immédiate » pour tous)
    body += `<p>Prenez rendez-vous chez <strong>${lxEsc(nom)}</strong>${ville ? " à " + lxEsc(ville) : ""} en ligne, 24h/24 et 7j/7. ${lxAnnEngagements(cfg, s).phrase}</p>`;
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
  // 2026-10-15 (sitemap v18) : /sitemap.xml = INDEX de sitemaps ; enfants /sitemap-pages.xml,
  // /sitemap-salons.xml, /sitemap-annuaire-<métier>.xml (edge function « sitemap », ?part=…).
  // Erreur / délai -> 503 + Retry-After (Google garde la version précédente) : plus jamais de
  // « sitemap minimal » en 200 qui ferait croire à Google que le site n'a qu'une URL.
  {
    const _sm = url.pathname === "/sitemap.xml" ? "index"
      : (url.pathname.match(/^\/sitemap-(pages|salons|annuaire-[a-z0-9-]{2,40})\.xml$/) || [])[1];
    if (_sm) {
      const _indispo = () => new Response("Sitemap temporairement indisponible", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "600", "Cache-Control": "no-store" },
      });
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 25000);
        let r;
        try {
          r = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/sitemap?part=${encodeURIComponent(_sm)}`, {
            // Cache edge 1 h pour les réponses 200 seulement (une erreur n'est jamais mise en cache)
            cf: { cacheTtlByStatus: { "200-299": 3600, "404": 600, "500-599": 0 }, cacheEverything: true },
            signal: ctl.signal,
          });
        } finally { clearTimeout(t); }
        if (r.status === 404) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=600" } });
        if (!r.ok) return _indispo();
        const xml = await r.text();
        if (!/<(urlset|sitemapindex)[\s>]/.test(xml)) return _indispo();
        return new Response(xml, {
          status: 200,
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600, s-maxage=3600",
            "X-Robots-Tag": "noindex",
          },
        });
      } catch (e) {
        return _indispo();
      }
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
# 2026-10-12 : adresses techniques (API) et modèle brut des pages salons, jamais à indexer
Disallow: /api/
Disallow: /rest/
Disallow: /site.html

# Index de sitemaps (pages, établissements, annuaire par métier)
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
    // 2026-10-11 : pages métier, démo libre, nouveaux articles
    "/logiciel-coiffure": "/logiciel-coiffure.html",
    "/logiciel-barbier": "/logiciel-barbier.html",
    "/logiciel-institut-beaute": "/logiciel-institut-beaute.html",
    "/logiciel-onglerie": "/logiciel-onglerie.html",
    "/logiciel-cils-sourcils": "/logiciel-cils-sourcils.html",
    "/logiciel-maquilleuse": "/logiciel-maquilleuse.html",
    "/logiciel-tatouage-piercing": "/logiciel-tatouage-piercing.html",
    "/logiciel-spa-massage": "/logiciel-spa-massage.html",
    "/logiciel-bien-etre": "/logiciel-bien-etre.html",
    "/demo": "/demo.html",
    "/verif-nf525": "/verif-nf525.html",
    "/blog/acompte-arrhes-empreinte-bancaire": "/blog/acompte-arrhes-empreinte-bancaire.html",
    "/blog/micro-entreprise-ou-societe-caisse-et-comptabilite": "/blog/micro-entreprise-ou-societe-caisse-et-comptabilite.html",
    "/blog/prestations-a-domicile-frais-de-deplacement": "/blog/prestations-a-domicile-frais-de-deplacement.html",
  };

  // 2026-10-13 : annuaire public « Métier à Ville » (comme Planity) + page de retrait
  {
    const _ann = url.pathname.match(/^\/(coiffeur|institut-de-beaute|spa-massage|onglerie|extension-de-cils|barbier)(?:\/([a-z0-9-]{2,80}))?\/?$/);
    if (_ann) { const _r = await lxAnnuairePage(_ann[1], _ann[2] || null); if (_r) return _r; }
    if (url.pathname === "/annuaire-retrait") return lxAnnuaireRetraitPage(url);
    if (url.pathname === "/annuaire-retrait-confirmer") return await lxAnnuaireRetraitConfirmerPage(url, env);
    if (url.pathname === "/annuaire-gerant") return await lxAnnuaireGerantPage(url);
  }
  let path = url.pathname;
  if (cleanRoutes[path]) path = cleanRoutes[path];
  // 2026-10-11 : guides illustrés du centre d'aide (/aide/<guide> → /aide/<guide>.html)
  else if (/^\/aide\/[a-z0-9-]+\/?$/.test(path)) path = path.replace(/\/$/, "") + ".html";

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
      "site", "index", "home", "verif-nf525", "tarifs", "sans-commission", "a-propos", "about", "securite-rgpd", "securite", "rgpd", "blog", "aide", "migration",
      "preview-email-confirmation", "clear",
      "sw.js", "manifest.json", "manifest-app.json", "manifest-admin.json",
      "icon-192.png", "icon-512.png", "luxyra-logo.png", "favicon.ico",
      "lx-client.js", "luxyra-supabase.js", "supabase.min.js",
      "robots.txt", "sitemap.xml", "coiffeur", "institut-de-beaute", "spa-massage", "onglerie", "extension-de-cils", "barbier", "annuaire-retrait", "annuaire-gerant", "annuaire-retrait-confirmer"
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
      let _lxSlugIntrouvable = false;
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
        // 2026-10-12 : adresse inconnue / établissement fermé / site désactivé -> « page introuvable » pour
        // Google (statut 404 + noindex) : avant, n'importe quelle adresse (ex. /100) répondait 200 et
        // finissait indexée comme une page vide. Le visiteur voit toujours le message de site.html.
        if (seo && seo.redirect && /^[a-z0-9][a-z0-9-]{1,79}$/i.test(seo.redirect)) {
          return Response.redirect(`https://luxyra.fr/${seo.redirect}${_reserverIntent ? "/reserver" : ""}`, 301);
        }
        if (seo && seo.notFound) _lxSlugIntrouvable = true;
      } catch (_) {
        // Silence total : la page normale est servie, le JS client fera le rendu.
      }
      if (_lxSlugIntrouvable) html = html.replace("</head>", () => '<meta name="robots" content="noindex,follow">\n</head>');

      return new Response(html, {
        status: _lxSlugIntrouvable ? 404 : 200,
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
// régularisé) : suppression des données personnelles non fiscales (fiches clients, photos, réservations et
// commandes en ligne anonymisées). Préavis par email à J-7. Tickets, clôtures, journal NF525 : conservés 6 ans.
// ============================================================
// ============================================================
// COMPTES CLIENTS INACTIFS (2026-10-12) — recommandation CNIL : 3 ans sans activité (connexion, réservation,
// demande, commande, avis). E-mail de préavis 30 jours avant ; une connexion annule tout. Puis suppression
// du compte (purge_compte_client_inactif) : les établissements gardent l'historique sans l'identité.
// ============================================================
async function runComptesClientsInactifs(env) {
  const out = { prevenus: 0, supprimes: 0, erreurs: 0 };
  const rc = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/comptes_inactifs_candidats`, { method: "POST", headers: _sbHeaders(env), body: "{}" });
  const c = rc.ok ? await rc.json() : null;
  if (!c) return { erreur: "candidats illisibles" };
  const le = new Date(Date.now() + 30 * 86400000).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long", year: "numeric" });
  for (const x of (c.a_prevenir || [])) {
    try {
      if (x.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x.email)) {
        const prenom = String(x.prenom || "").replace(/</g, "&lt;");
        await brevoSendEmail(env, { to: x.email, toName: x.prenom || "", senderEmail: "contact@luxyra.fr", senderName: "Luxyra",
          subject: `Votre compte Luxyra sera supprimé le ${le}`,
          htmlContent: lxMailLayout(`<p>Bonjour${prenom ? " " + prenom : ""},</p><p>Vous n'avez pas utilisé votre compte Luxyra depuis <b>3 ans</b>. Pour protéger vos données, nous supprimons les comptes inactifs : <b>votre compte sera supprimé le ${le}</b> (historique de rendez-vous, factures et photos consultables dans votre espace).</p><p><b>Vous souhaitez le garder ?</b> Il suffit de vous connecter une fois avant cette date.</p><p style="text-align:center;margin:22px 0"><a href="https://luxyra.fr/compte" style="background:#c8a84e;color:#000;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700">Me connecter</a></p><p style="font-size:13px;color:#666">Sans action de votre part, le compte sera supprimé. Les établissements que vous avez fréquentés conservent leurs propres documents (factures, tickets) comme la loi l'exige.</p>`, { titre: "Votre compte va être supprimé" }),
          textContent: `Votre compte Luxyra est inactif depuis 3 ans et sera supprimé le ${le}. Pour le garder, connectez-vous une fois avant cette date : https://luxyra.fr/compte`, replyTo: null, attachment: null });
      }
      await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/clients_luxyra?id=eq.${x.id}`, { method: "PATCH", headers: _sbHeaders(env, { "Prefer": "return=minimal" }), body: JSON.stringify({ inactivite_preavis_le: new Date().toISOString() }) });
      out.prevenus++;
    } catch (e) { out.erreurs++; console.error("compte inactif préavis", x.id, e?.message || e); }
  }
  for (const x of (c.a_supprimer || [])) {
    try {
      const rp = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/purge_compte_client_inactif`, { method: "POST", headers: _sbHeaders(env), body: JSON.stringify({ p_id: x.id }) });
      const r = rp.ok ? await rp.json() : null;
      if (r && r.ok) out.supprimes++; else out.erreurs++;
    } catch (e) { out.erreurs++; console.error("compte inactif purge", x.id, e?.message || e); }
  }
  if (out.supprimes) { try { await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/notify_admins`, { method: "POST", headers: _sbHeaders(env), body: JSON.stringify({ p_event_type: "payment_failed", p_title: "🧹 Comptes clients inactifs", p_body: `${out.supprimes} compte(s) client inactif(s) depuis 3 ans supprimé(s).`, p_url: "/admin.html", p_payload: {} }) }); } catch (_) {} }
  return out;
}

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
          htmlContent: lxMailLayout(`<p>Bonjour,</p><p>Votre service Luxyra pour <b>${String(s.nom || "votre établissement").replace(/</g, "&lt;")}</b> n'est plus actif. Conformément à nos conditions et au RGPD, <b>les données personnelles de vos clients</b> (fiches, notes, photos, rendez-vous, réservations en ligne) <b>seront supprimées le ${le}</b>.</p><p>D'ici là, vous pouvez vous reconnecter pour <b>exporter vos données</b> ou <b>réactiver votre abonnement</b> : tout sera conservé à l'identique.</p><p>Vos documents de caisse (tickets, clôtures, journal) restent conservés 6 ans, comme l'exige la loi, et consultables en mode archives.</p><p style="text-align:center;margin:22px 0"><a href="https://luxyra.fr/app" style="background:#c8a84e;color:#000;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700">Me connecter</a></p>`, { titre: `Suppression prochaine de vos données` }),
          textContent: `Les données personnelles de vos clients (fiches, notes, photos, rendez-vous) seront supprimées le ${le}. Reconnectez-vous d'ici là pour exporter vos données ou réactiver votre abonnement : https://luxyra.fr/app . Vos documents de caisse restent conservés 6 ans.`, replyTo: null, attachment: null });
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
      // photos des clients (stockage) : dossier client-photos/<salon_id>/
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
      try { await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/notify_admins`, { method: "POST", headers: _sbHeaders(env), body: JSON.stringify({ p_event_type: "payment_failed", p_title: "🧹 RGPD J+60", p_body: `${s.nom} : ${r.clients} fiche(s) client(s) supprimée(s)${r.photos ? ", " + r.photos + " photo(s)" : ""}. Données de caisse conservées.`, p_url: "/admin.html", p_payload: {} }) }); } catch (_) {}
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
  try { console.log("[comptes inactifs 3 ans]", JSON.stringify(await runComptesClientsInactifs(env))); } catch (e) { console.error("[comptes inactifs]", e?.message || e); }
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

  // === PHASES 1 & 2 — CONSERVATION 6 ANS (2026-10-12) ===
  // Fin de conservation = 6 ans après la DERNIÈRE opération de caisse ou la fin du service (la plus tardive),
  // calculée en base (lx_prive.salon_fin_conservation). Préavis e-mail 30 jours avant, puis suppression complète
  // par purge_salon_6ans (vérifie elle-même délai + préavis, trace dans salons_purges / admin_log).
  // (Avant : simple DELETE sur salons, qui échouait sur les garde-fous NF525.)
  try {
    const rc = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/retention_6ans_candidats`, { method: "POST", headers: _sbHeaders(env), body: "{}" });
    const c = rc.ok ? await rc.json() : null;
    if (!c) { stats.errors++; console.warn(`[retention] candidats illisibles: ${rc.status}`); }
    for (const salon of ((c && c.a_prevenir) || [])) {
      try {
        if (salon.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(salon.email)) await sendRetentionWarningEmail(env, salon);
        await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/salons?id=eq.${salon.id}`, {
          method: "PATCH",
          headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify({ retention_warned_at: new Date().toISOString() })
        });
        stats.warned++;
        stats.details.push({ phase: "warned", id: salon.id, nom: salon.nom });
      } catch (e) { stats.errors++; console.error(`[retention] préavis ${salon.id}:`, e?.message || e); }
    }
    for (const salon of ((c && c.a_supprimer) || [])) {
      try {
        const rp = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/purge_salon_6ans`, { method: "POST", headers: _sbHeaders(env), body: JSON.stringify({ p_salon: salon.id }) });
        const r = rp.ok ? await rp.json() : null;
        if (!r || !r.ok) { stats.errors++; console.error(`[retention] purge ${salon.id} refusée:`, r && r.err); continue; }
        // Fichiers : justificatifs + photos clients du salon
        for (const [bucket, prefixe] of [["salon-documents", `documents/${salon.id}`], ["client-photos", salon.id]]) {
          try {
            const chemins = [];
            const lst = await fetch(`${CONFIG.SUPABASE_URL}/storage/v1/object/list/${bucket}`, { method: "POST", headers: _sbHeaders(env), body: JSON.stringify({ prefix: prefixe, limit: 1000 }) });
            for (const it of (lst.ok ? await lst.json() : [])) {
              if (it.id) chemins.push(`${prefixe}/${it.name}`);
              else {
                const l2 = await fetch(`${CONFIG.SUPABASE_URL}/storage/v1/object/list/${bucket}`, { method: "POST", headers: _sbHeaders(env), body: JSON.stringify({ prefix: `${prefixe}/${it.name}`, limit: 1000 }) });
                for (const x of (l2.ok ? await l2.json() : [])) if (x.id) chemins.push(`${prefixe}/${it.name}/${x.name}`);
              }
            }
            if (chemins.length) await fetch(`${CONFIG.SUPABASE_URL}/storage/v1/object/${bucket}`, { method: "DELETE", headers: _sbHeaders(env), body: JSON.stringify({ prefixes: chemins }) });
          } catch (_) {}
        }
        // Compte de connexion du gérant : supprimé seulement s'il n'a aucun autre établissement et n'est pas un compte Luxyra
        try {
          if (r.user_id && Number(r.autres_salons) === 0) {
            const adm = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/admin_users?select=user_id&user_id=eq.${r.user_id}`, { headers: _sbHeaders(env) });
            const estAdmin = adm.ok ? ((await adm.json()) || []).length > 0 : true;
            if (!estAdmin) await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/admin/users/${r.user_id}`, { method: "DELETE", headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } });
          }
        } catch (_) {}
        stats.purged++;
        stats.details.push({ phase: "purged", id: salon.id, nom: salon.nom, lignes: r.lignes });
        try { await sendRetentionPurgedAdminEmail(env, { id: salon.id, nom: salon.nom, cancelled_at: salon.fin }); } catch (_e) {}
      } catch (e) { stats.errors++; console.error(`[retention] purge ${salon.id}:`, e?.message || e); }
    }
  } catch (e) {
    console.error("[retention] 6 ans exception:", e?.message || e);
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

// Email préavis 30 jours avant suppression (2026-10-12 : mise en page Luxyra commune, lxMailLayout)
async function sendRetentionWarningEmail(env, salon) {
  if (!env.BREVO_API_KEY) { console.warn("[retention] BREVO_API_KEY missing — skip email"); return; }
  // date calculée en base (6 ans après la dernière opération de caisse ou la fin du service)
  let purgeDate;
  if (salon.fin) purgeDate = new Date(salon.fin);
  else { purgeDate = new Date(salon.cancelled_at); purgeDate.setFullYear(purgeDate.getFullYear() + 6); }
  const purgeFmt = purgeDate.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long", year: "numeric" });
  const nom = String(salon.nom || "votre établissement").replace(/</g, "&lt;");
  const corps = `<p>Bonjour,</p>
<p>Le service Luxyra de <b>${nom}</b> a pris fin il y a près de 6 ans. Comme la loi l'impose (art. L102 B du Livre des procédures fiscales), nous avons conservé vos documents de caisse pendant toute cette durée.</p>
<div style="background:#fbf6e9;border-left:4px solid #c8a84e;padding:14px 16px;margin:18px 0;border-radius:6px"><b>Vos données seront supprimées définitivement le ${purgeFmt}</b> (dans environ 30 jours) : tickets, clôtures, journal, factures et toutes les autres données de l'établissement.</div>
<p>Pour garder une copie, connectez-vous d'ici là en mode archives (lecture seule) et téléchargez vos documents : tickets, FEC pour votre expert-comptable, archive fiscale signée.</p>
${lxMailBouton("Accéder à mes archives", "https://luxyra.fr/app")}
<p style="font-size:13px;color:#666">Une fois connecté, choisissez « Accéder à mes archives comptables ». Après le ${purgeFmt}, plus aucune récupération ne sera possible.</p>`;
  try {
    await brevoSendEmail(env, { to: salon.email, toName: salon.nom || "", senderEmail: "contact@luxyra.fr", senderName: "Luxyra",
      subject: `Vos données Luxyra seront supprimées le ${purgeFmt}`,
      htmlContent: lxMailLayout(corps, { titre: "Suppression prochaine de vos archives" }),
      textContent: `Le service Luxyra de ${salon.nom || "votre établissement"} a pris fin il y a près de 6 ans. Vos documents de caisse et toutes les données de l'établissement seront supprimés définitivement le ${purgeFmt}. Pour garder une copie, connectez-vous en mode archives d'ici là : https://luxyra.fr/app`,
      replyTo: null, attachment: null });
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
  // 2026-10-17 audit réglages (#4) : un simple affichage (GET : antivirus / aperçu des messageries qui ouvrent les liens)
  // ne désinscrit plus personne : page de confirmation, la désinscription se fait au clic (POST, ou « un clic » RFC 8058).
  if (request.method === "GET") return htmlResponse(lxPageConfirmerDesinscription(url.pathname + url.search, channel === "sms" ? "des SMS" : channel === "all" ? "de toutes les communications" : "des e-mails", ""));

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

// 2026-10-17 audit réglages (#4) : page de confirmation (formulaire POST) — rien n'est modifié à l'affichage
function lxPageConfirmerDesinscription(action, quoi, salon) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Désinscription — Luxyra</title>
<style>body{font-family:'Helvetica Neue',Arial,sans-serif;background:#0a0a0a;color:#f5f0e8;margin:0;padding:40px 20px;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#fff;color:#1a1a1a;max-width:480px;width:100%;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.3)}
.head{background:#0a0a0a;color:#c8a84e;padding:20px;text-align:center;letter-spacing:3px;font-weight:800;font-family:Georgia,serif;font-size:22px}
.body{padding:32px 28px;text-align:center}.msg{color:#444;font-size:15px;line-height:1.6;margin-bottom:22px}
button{background:#c8a84e;color:#111;border:0;border-radius:30px;padding:13px 26px;font-weight:700;font-size:15px;cursor:pointer}
.note{font-size:12px;color:#888;padding-top:18px;border-top:1px solid #eee;line-height:1.6;margin-top:22px}.note a{color:#c8a84e;text-decoration:none}</style></head><body>
<div class="card"><div class="head">LUXYRA</div><div class="body">
<div class="msg">Ne plus recevoir ${escapeHtml(quoi)}${salon ? " de <b>" + escapeHtml(salon) + "</b>" : ""} ?</div>
<form method="POST" action="${escapeHtml(action)}"><input type="hidden" name="confirmer" value="1"><button type="submit">Confirmer la désinscription</button></form>
<div class="note">Les messages liés à vos rendez-vous (confirmations, rappels) peuvent continuer d'être envoyés.<br>Vous pourrez changer d'avis à tout moment auprès de l'établissement ou dans votre espace client <a href="https://luxyra.fr/compte">luxyra.fr/compte</a>.</div>
</div></div></body></html>`;
}
// GET /stop/<code> ou /s/<code> : confirmation ; POST : désinscription (formulaire, ou « un clic » des messageries)
async function lxPageStop(request, env, code, base) {
  try {
    if (request.method === "GET") {
      // 2026-10-17 lien court : 6 caractères -> limite de consultation par adresse IP (pas d'essais en masse)
      const ipG = request.headers.get("CF-Connecting-IP") || "unknown";
      if (!checkRateLimit("stopget:" + ipG, 30)) return htmlResponse(unsubscribePage("error", "Trop de demandes. Réessayez dans une minute."), 429);
      const ri = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/lx_desinscription_info`, { method: "POST", headers: _sbHeaders(env), body: JSON.stringify({ p_code: code }) });
      const info = ri.ok ? await ri.json() : null;
      if (!info || info.ok !== true) return htmlResponse(unsubscribePage("error", "Lien invalide ou expiré."), 404);
      if (info.deja === true) return htmlResponse(unsubscribePage("ok", "Votre désinscription est déjà enregistrée."));
      return htmlResponse(lxPageConfirmerDesinscription(`${base || "/stop/"}${code}`, info.canal === "sms" ? "les SMS publicitaires (offres, anniversaire, relances)" : info.canal === "all" ? "aucune communication" : "les e-mails d'information et d'offres", info.salon || ""));
    }
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (!checkRateLimit("stop:" + ip, 20)) return htmlResponse(unsubscribePage("error", "Trop de demandes. Réessayez dans une minute."), 429);
    const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/lx_desinscrire_code`, { method: "POST", headers: _sbHeaders(env), body: JSON.stringify({ p_code: code }) });
    const res = r.ok ? await r.json() : null;
    if (!res || res.ok !== true) return htmlResponse(unsubscribePage("error", (res && res.erreur) || "Lien invalide ou expiré."), 404);
    const quoi = res.canal === "sms" ? "des SMS" : res.canal === "all" ? "de toutes les communications" : "des e-mails";
    return htmlResponse(unsubscribePage("ok", `Vous êtes désabonné ${quoi}${res.salon ? " de " + res.salon : ""}.`));
  } catch (e) {
    console.error("[stop]", e?.message || e);
    return htmlResponse(unsubscribePage("error", "Erreur serveur. Réessayez ou écrivez à support@luxyra.fr"), 500);
  }
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
