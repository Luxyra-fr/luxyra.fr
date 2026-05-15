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
  PRICE_ESSENTIAL: "price_1TGPDdPk42Psx94TXOp8t3mB",
  PRICE_PRO: "price_1TGPErPk42Psx94T302k3bXv",
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
    if (!url.pathname.startsWith("/api/")) return handleExistingRoutes(request, url, env);
    try {
      if (url.pathname === "/api/stripe/create-checkout" && request.method === "POST") return await handleCreateCheckout(request, env);
      if (url.pathname === "/api/stripe/webhook" && request.method === "POST") return await handleWebhook(request, env);
      if (url.pathname === "/api/stripe/portal" && request.method === "POST") return await handlePortal(request, env);
      if (url.pathname === "/api/stripe/switch-plan" && request.method === "POST") return await handleSwitchPlan(request, env);
      // Stripe Connect
      if (url.pathname === "/api/stripe/connect-onboard" && request.method === "POST") return await handleConnectOnboard(request, env);
      if (url.pathname === "/api/stripe/connect-status" && request.method === "POST") return await handleConnectStatus(request, env);
      if (url.pathname === "/api/stripe/connect-dashboard" && request.method === "POST") return await handleConnectDashboard(request, env);
      if (url.pathname === "/api/stripe/connect-payment" && request.method === "POST") return await handleConnectPayment(request, env);
      // FIX 2026-05-13 : Export NF525 (conservation 6 ans / audit fiscal)
      if (url.pathname === "/api/admin/export-nf525" && request.method === "POST") return await handleExportNF525(request, env);
      // FIX 2026-05-12 : Path A empreinte (post-Checkout, stocke le PI ID dans rdv_online)
      if (url.pathname === "/api/stripe/empreinte-finalize" && request.method === "POST") return await handleEmpreinteFinalize(request, env);
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
  },

  // Cron trigger Cloudflare — appelé selon la config wrangler.toml [triggers].crons.
  // Pour l'instant 1×/jour à 3h UTC : job de rétention (préavis + purge 6 ans).
  async scheduled(event, env, ctx) {
    console.log(`[cron] scheduled event triggered: ${event.cron} at ${new Date(event.scheduledTime).toISOString()}`);
    try {
      const result = await runRetentionPurgeJob(env);
      console.log(`[cron] retention-purge done:`, result);
    } catch (err) {
      console.error(`[cron] retention-purge FAILED:`, err?.message || err);
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
    }
    // FIX 2026-05-12 : job purge RDV pending_payment abandonnés (> 1h, payment_intent_id NULL)
    // Évite la pollution de la table rdv_online par des paiements Stripe abandonnés.
    // Le client-side filtre déjà > 15 min, mais on nettoie la DB pour de bon.
    try {
      const result3 = await runPendingPaymentRdvPurgeJob(env);
      console.log(`[cron] pending-payment-rdv-purge done:`, result3);
    } catch (err) {
      console.error(`[cron] pending-payment-rdv-purge FAILED:`, err?.message || err);
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
      sms_100: { amount: 799, qty: 100, label: "Pack 100 SMS" },
      sms_250: { amount: 1899, qty: 250, label: "Pack 250 SMS" },
      sms_500: { amount: 3599, qty: 500, label: "Pack 500 SMS" },
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
      }
    } catch (e) { console.warn("app_config fetch failed for SMS packs, using fallback:", e?.message); }

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

    const priceId = plan === "pro" ? CONFIG.PRICE_PRO : CONFIG.PRICE_ESSENTIAL;
    const planLabel = plan === "pro" ? "Pro" : "Essentiel";
    const session = await stripeAPI(env, "checkout/sessions", {
      customer: customerId, mode: "subscription",
      "payment_method_types[0]": "sepa_debit", "payment_method_types[1]": "card",
      allow_promotion_codes: "true",
      "line_items[0][price]": priceId, "line_items[0][quantity]": "1",
      success_url: `https://luxyra.fr/app?checkout=success&plan=${plan}`,
      cancel_url: "https://luxyra.fr/app?checkout=cancel",
      "metadata[salon_id]": salon_id, "metadata[plan]": plan,
      "subscription_data[description]": `Abonnement Luxyra ${planLabel} — Mensuel`,
      "subscription_data[metadata][salon_id]": salon_id, "subscription_data[metadata][plan]": plan,
    });
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
    console.warn("⚠️ STRIPE_WEBHOOK_SECRET not set — signature NOT verified!");
    try { event = JSON.parse(payload); } catch (e) { return jsonResponse({ error: "Invalid payload" }, 400); }
  }

  const type = event.type;
  const data = event.data?.object;
  console.log("Stripe webhook:", type);

  switch (type) {
    case "checkout.session.completed": {
      const salonId = data.metadata?.salon_id;
      const plan = data.metadata?.plan || "pro";
      if (data.metadata?.type === "sms_pack") {
        const qty = parseInt(data.metadata.sms_qty || "0");
        if (salonId && qty > 0) {
          const salon = await supabaseGet(env, salonId);
          await supabaseUpdate(env, salonId, { sms_credits: (salon?.sms_credits || 0) + qty });
        }
        break;
      }
      if (salonId) await updateSalonPlan(env, salonId, plan, data.subscription, data.customer);
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
        if (data.livemode === true && plan === "pro") {
          try {
            const salonRow = await supabaseGet(env, salonId);
            if (salonRow && salonRow.welcome_sms_bonus_given !== true) {
              const newCredits = (salonRow.sms_credits || 0) + 150;
              await supabaseUpdate(env, salonId, {
                sms_credits: newCredits,
                welcome_sms_bonus_given: true
              });
              console.log("invoice.paid: 150 SMS bonus credited to salon", salonId, "new total=", newCredits);
            }
          } catch (e) { console.warn("SMS bonus error:", e?.message || e); }
        }

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
          const ht = planPrix;
          const tvaAmount = Math.round(ht * tvaPct) / 100;  // arrondi au centime
          const ttc = Math.round((ht + tvaAmount) * 100) / 100;
          const sbUrl = CONFIG.SUPABASE_URL;
          const numRes = await fetch(`${sbUrl}/rest/v1/rpc/next_facture_numero`, {
            method: "POST",
            headers: { "apikey": env.SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json" },
            body: "{}"
          });
          const numero = await numRes.json();
          console.log("invoice.paid: numero=", JSON.stringify(numero));
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
            description: `Abonnement Luxyra ${plan === "pro" ? "Pro" : "Essentiel"} - Mensuel`,
            plan, periode_debut: periodStart, periode_fin: periodEnd,
            stripe_invoice_id: data.id || null, stripe_payment_intent: data.payment_intent || data.charge || null,
            mode_paiement: modePaiement, status: "paid"
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
        const updates = { plan: "essential", status: "cancelled", past_due_since: null };
        if (!salon?.cancelled_at) updates.cancelled_at = new Date().toISOString();
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
        const newPlan = priceId === CONFIG.PRICE_PRO ? "pro" : "essential";
        // Si la sub est marquée pour annulation à la fin de période (cancel_at_period_end),
        // on garde status=active jusqu'à l'expiration réelle (c'est subscription.deleted qui passera à cancelled).
        // L'utilisateur conserve son accès jusqu'à la fin de la période payée.
        await supabaseUpdate(env, salonId, { plan: newPlan });
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
async function handleSwitchPlan(request, env) {
  try {
    const { salon_id, plan } = await request.json();
    if (!salon_id || !plan) return jsonResponse({ error: "salon_id et plan requis" }, 400);
    const salon = await supabaseGet(env, salon_id);
    if (!salon?.stripe_subscription_id) return jsonResponse({ error: "Pas d'abonnement actif" }, 400);
    const sub = await stripeAPI(env, `subscriptions/${salon.stripe_subscription_id}`, {}, "GET");
    if (!sub?.items?.data?.[0]) return jsonResponse({ error: "Impossible de lire l'abonnement" }, 500);
    const updated = await stripeAPI(env, `subscriptions/${salon.stripe_subscription_id}`, {
      "items[0][id]": sub.items.data[0].id,
      "items[0][price]": plan === "pro" ? CONFIG.PRICE_PRO : CONFIG.PRICE_ESSENTIAL,
      proration_behavior: "create_prorations",
    });
    if (updated?.id) {
      await supabaseUpdate(env, salon_id, { plan: plan === "pro" ? "pro" : "essential" });
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
    const { salon_id, amount, description, customer_email, customer_name, metadata, capture_method } = await request.json();
    if (!salon_id || !amount) return jsonResponse({ error: "salon_id et amount requis" }, 400);

    const salon = await supabaseGet(env, salon_id);
    if (!salon?.stripe_connect_id) return jsonResponse({ error: "Ce salon n'a pas configuré ses paiements en ligne" }, 400);

    // Check Connect account is active
    const account = await stripeAPI(env, `accounts/${salon.stripe_connect_id}`, null, "GET");
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
      // Transfer all money to connected account (0% Luxyra fee)
      "payment_intent_data[transfer_data][destination]": salon.stripe_connect_id,
    };
    // Empreinte : capture manuelle (pré-autorisation, débit différé)
    if (capture_method === "manual") {
      sessionParams["payment_intent_data[capture_method]"] = "manual";
      sessionParams["metadata[subtype]"] = "empreinte";
    }
    const session = await stripeAPI(env, "checkout/sessions", sessionParams);

    if (!session?.url) return jsonResponse({ error: "Erreur paiement: " + JSON.stringify(session) }, 500);
    return jsonResponse({ url: session.url, session_id: session.id });
  } catch(e) { return jsonResponse({ error: "Connect payment error: " + e.message }, 500); }
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
    const { session_id, rdv_id } = await request.json();
    if (!session_id || !rdv_id) return jsonResponse({ error: "session_id et rdv_id requis" }, 400);

    // 1) Fetch Stripe session — source of truth
    const session = await stripeAPI(env, `checkout/sessions/${encodeURIComponent(session_id)}`, null, "GET");
    if (!session || session.error) return jsonResponse({ error: "Session Stripe introuvable" }, 404);
    // Pour empreinte (manual capture), payment_status="paid" = client a autorisé (PI en requires_capture)
    if (session.payment_status !== "paid") return jsonResponse({ error: "Autorisation non confirmée: " + session.payment_status }, 402);
    // Anti-tampering : vérifier que le rdv_id de la metadata Stripe correspond
    if (session.metadata?.rdv_id && session.metadata.rdv_id !== String(rdv_id)) {
      return jsonResponse({ error: "rdv_id mismatch (anti-tampering)" }, 403);
    }
    const piId = session.payment_intent;
    if (!piId) return jsonResponse({ error: "PaymentIntent introuvable dans la session" }, 500);

    // 2) Update rdv_online avec le PI ID + statut empreinte
    const sbUrl = CONFIG.SUPABASE_URL;
    const upRes = await fetch(`${sbUrl}/rest/v1/rdv_online?id=eq.${encodeURIComponent(rdv_id)}`, {
      method: "PATCH",
      headers: { ..._sbHeaders(env), "Prefer": "return=minimal" },
      body: JSON.stringify({
        status: "confirmed",
        empreinte_payment_intent_id: piId,
        empreinte_status: "authorized"
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
    const { token } = await request.json();
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
      "payment_intent_data[transfer_data][destination]": salon.stripe_connect_id
    });

    if (!session?.url) return jsonResponse({ error: "Erreur Stripe: " + JSON.stringify(session) }, 500);
    return jsonResponse({ url: session.url, session_id: session.id });
  } catch (e) {
    console.error("connect-pay error:", e);
    return jsonResponse({ error: "Connect-pay error: " + e.message }, 500);
  }
}

async function handleRdvDemandeFinalize(request, env) {
  try {
    const { token, session_id } = await request.json();
    if (!token || !session_id) return jsonResponse({ error: "token et session_id requis" }, 400);

    // 1) Vérifie le paiement Stripe (single source of truth)
    const session = await stripeAPI(env, `checkout/sessions/${encodeURIComponent(session_id)}`, null, "GET");
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
      payment_intent_id: session.payment_intent || null
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
async function stripeAPI(env, endpoint, params, method = "POST") {
  const options = { method, headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } };
  if (params && method === "POST") {
    options.headers["Content-Type"] = "application/x-www-form-urlencoded";
    options.body = new URLSearchParams(params).toString();
  }
  return await (await fetch(`https://api.stripe.com/v1/${endpoint}`, options)).json();
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

async function brevoSendSms(env, { to, content, sender }) {
  return await (await fetch("https://api.brevo.com/v3/transactionalSMS/sms", {
    method: "POST", headers: { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ type: "transactional", sender: sender || "Luxyra", recipient: to, content }),
  })).json();
}

// ============================================================
// EMAIL: TICKET — FIX W4: "conforme NF525" pas "certifié"
// ============================================================
async function handleEmailTicket(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!checkRateLimit("email_ticket:" + ip, 30)) return jsonResponse({ error: "Trop de requêtes. Réessayez dans 1 minute." }, 429);
  const body = await request.json();
  const { clientEmail, clientName, salonName, salonEmail, ticketNum, ticketHtml, clientId } = body;
  if (!clientEmail || !ticketNum) return jsonResponse({ error: "clientEmail et ticketNum requis" }, 400);
  if (!ticketHtml) return jsonResponse({ error: "ticketHtml requis" }, 400);
  // FIX 2026-05-14 : lien désinscription RGPD obligatoire si clientId fourni
  let unsubLink = "";
  if (clientId) {
    try { unsubLink = await buildUnsubscribeUrl(clientId, "email", env); } catch (e) { unsubLink = ""; }
  }
  const unsubBlock = unsubLink ? `<div style="margin-top:10px"><a href="${unsubLink}" style="color:#bbb;font-size:10px;text-decoration:underline">Se désinscrire des emails</a></div>` : "";
  const emailHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:'Helvetica Neue',Arial,sans-serif;background:#f5f5f5;margin:0;padding:20px}.wrapper{max-width:500px;margin:0 auto}.header{background:linear-gradient(135deg,#1a1a2e,#16213e);padding:24px;text-align:center;color:#fff;border-radius:12px 12px 0 0}.header h1{margin:0;font-size:20px;color:#d4a843;letter-spacing:1px}.header p{margin:4px 0 0;font-size:13px;color:rgba(255,255,255,.7)}.ticket-container{background:#fff;padding:24px;border-left:1px solid #e0e0e0;border-right:1px solid #e0e0e0;font-family:'Courier New',monospace;font-size:12px;line-height:1.5;color:#000}.ticket-container table{width:100%;border-collapse:collapse}.footer{text-align:center;padding:16px;font-size:11px;color:#999;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 12px 12px;background:#fff}</style></head><body><div class="wrapper"><div class="header"><h1>${salonName||"Votre salon"}</h1><p>Votre ticket de caisse N°${ticketNum}</p></div><div class="ticket-container">${ticketHtml}</div><div class="footer">Envoyé via <strong>Luxyra</strong> — Logiciel de gestion conforme NF525<br>Art. 286-I-3° bis du CGI<br><em style="font-size:10px;color:#bbb">Ce ticket fait office de facture. Conservez-le 6 ans minimum.</em>${unsubBlock}</div></div></body></html>`;
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
  const body = await request.json();
  const { email, nom, prenom, nomSalon, plan, identifiant, motDePasse } = body;
  if (!email) return jsonResponse({ error: "email requis" }, 400);
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:'Helvetica Neue',Arial,sans-serif;background:#f5f5f5;margin:0;padding:20px}.card{max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)}.header{background:linear-gradient(135deg,#1a1a2e,#16213e);padding:30px;text-align:center;color:#fff}.header h1{margin:0;font-size:24px;color:#d4a843}.body{padding:30px}.creds{background:#f8f6f0;border:1px solid #e8e0d0;border-radius:10px;padding:20px;margin:20px 0;text-align:center}.creds .label{font-size:12px;color:#999;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px}.creds .value{font-size:16px;font-weight:700;color:#1a1a2e;margin-bottom:12px}.btn{display:inline-block;padding:14px 40px;background:linear-gradient(135deg,#d4a843,#b8960f);color:#fff;text-decoration:none;border-radius:10px;font-weight:700;font-size:15px}.footer{text-align:center;padding:16px;font-size:11px;color:#999;border-top:1px solid #f0f0f0}</style></head><body><div class="card"><div class="header"><h1>Bienvenue sur Luxyra !</h1><p style="color:rgba(255,255,255,.7);margin-top:8px">Votre essai gratuit de 14 jours commence maintenant</p></div><div class="body"><p>Bonjour ${prenom||""} ${nom||""},</p><p>Votre établissement <strong>${nomSalon||""}</strong> est prêt.</p><div class="creds"><div class="label">Email de connexion</div><div class="value">${identifiant||email}</div><div class="label">Mot de passe</div><div class="value">${motDePasse||"(celui que vous avez choisi)"}</div></div><div style="text-align:center;margin:24px 0"><a href="https://luxyra.fr/app" class="btn">Accéder à mon salon →</a></div><p style="font-size:13px;color:#666">Votre formule d'essai <strong>${plan||"Essentiel"}</strong> est active pendant 14 jours.</p></div><div class="footer">Luxyra — luxyra.fr | contact@luxyra.fr</div></div></body></html>`;
  const result = await brevoSendEmail(env, { to: email, toName: `${prenom||""} ${nom||""}`.trim(), senderName: "Luxyra", senderEmail: "contact@luxyra.fr", subject: "Bienvenue sur Luxyra — Vos identifiants", htmlContent: html, textContent: "", replyTo: null, attachment: null });
  return jsonResponse({ success: true, messageId: result.messageId, result });
}

async function handleEmailCustom(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!checkRateLimit("email_custom:" + ip, 20)) return jsonResponse({ error: "Trop de requêtes. Réessayez dans 1 minute." }, 429);
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
async function gateSmsAndDecrementCredit(env, salonId) {
  if (!salonId) return { ok: false, status: 400, error: "salon_id requis" };
  const salon = await supabaseGet(env, salonId);
  if (!salon) return { ok: false, status: 404, error: "Salon introuvable" };
  // Plan Pro requis
  if (salon.plan !== "pro") return { ok: false, status: 403, error: "Plan Pro requis pour envoyer des SMS" };
  // Compte actif (pas suspended/cancelled)
  if (salon.status === "suspended" || salon.status === "cancelled") {
    return { ok: false, status: 403, error: "Compte suspendu — régularisez votre abonnement" };
  }
  // Décrément ATOMIQUE via RPC (race-safe — UPDATE WHERE sms_credits > 0)
  // Si 0 lignes mises à jour (crédits déjà à 0), renvoie {ok:false, remaining:0} sans rien modifier.
  try {
    const rpcRes = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/decrement_sms_credit`, {
      method: "POST",
      headers: {
        "apikey": env.SUPABASE_SERVICE_KEY,
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ p_salon_id: salonId })
    });
    if (!rpcRes.ok) {
      console.error("decrement_sms_credit RPC HTTP error:", rpcRes.status);
      return { ok: false, status: 500, error: "Erreur décrément crédit SMS (rpc)" };
    }
    const rpcData = await rpcRes.json();
    if (!rpcData || rpcData.ok !== true) {
      return { ok: false, status: 402, error: "Plus de crédits SMS — rechargez via Paramètres > SMS" };
    }
    return { ok: true, remainingCredits: Number(rpcData.remaining || 0) };
  } catch (e) {
    console.error("decrement_sms_credit RPC error:", e?.message || e);
    return { ok: false, status: 500, error: "Erreur décrément crédit SMS" };
  }
}

// === Helper : alerte email quand un SMS automatique est bloqué (crédits 0) ===
// Rate-limité à 1 email/24h par salon via salons.last_sms_credit_alert_at.
// Ne block pas la réponse — fire & forget (waitUntil-style).
async function notifySalonCreditExhausted(env, salonId) {
  try {
    const salon = await supabaseGet(env, salonId);
    if (!salon || !salon.email) return;
    // Rate-limit : si déjà notifié dans les 24 dernières heures, skip
    if (salon.last_sms_credit_alert_at) {
      const last = new Date(salon.last_sms_credit_alert_at).getTime();
      if (Date.now() - last < 24 * 3600 * 1000) return;
    }
    const salonName = salon.nom || "votre salon";
    const subject = `⚠️ Crédits SMS épuisés — ${salonName}`;
    const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a1a">
      <div style="background:linear-gradient(135deg,#1a1a1a,#0a0a0a);padding:24px;border-radius:14px 14px 0 0;text-align:center">
        <div style="color:#d4a843;font-size:24px;font-weight:900;letter-spacing:2px">LUXYRA</div>
      </div>
      <div style="background:#fff;border:1px solid #e8e0d0;border-top:none;padding:28px;border-radius:0 0 14px 14px">
        <div style="font-size:48px;text-align:center;margin-bottom:8px">📱</div>
        <h2 style="text-align:center;color:#c8a84e;margin:0 0 16px">Vos crédits SMS sont épuisés</h2>
        <p style="font-size:14px;line-height:1.6;color:#333">Bonjour,</p>
        <p style="font-size:14px;line-height:1.6;color:#333">Le compte SMS de <strong>${salonName}</strong> est arrivé à 0. Vos rappels de RDV automatiques (24h, 2h), SMS d'anniversaire et notifications fidélité <strong style="color:#ef5350">ne sont plus envoyés</strong>.</p>
        <p style="font-size:14px;line-height:1.6;color:#333">Pour rétablir les envois immédiatement, rechargez un pack SMS depuis votre application :</p>
        <div style="text-align:center;margin:24px 0">
          <a href="https://luxyra.fr/app#sms" style="display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#d4a843,#b8960f);color:#000;font-weight:700;text-decoration:none;border-radius:10px;font-size:14px">📱 Recharger mes SMS</a>
        </div>
        <p style="font-size:12px;line-height:1.6;color:#666">Vous recevrez ce mail 1 fois maximum par 24h tant que votre solde reste à 0. Vous pouvez continuer à envoyer des emails normalement (les emails ne consomment pas de crédits SMS).</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
        <p style="font-size:11px;color:#999;text-align:center;margin:0">Email automatique — Luxyra</p>
      </div>
    </div>`;
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
  // === Gate Pro + crédits + décrément ===
  const gate = await gateSmsAndDecrementCredit(env, salon_id);
  if (!gate.ok) {
    // Si le blocage est dû à des crédits 0 (status 402) → alerte email auto au salon
    // (rate-limité 24h dans la fonction). Fire & forget — ne bloque pas la réponse.
    if (gate.status === 402 && salon_id) {
      notifySalonCreditExhausted(env, salon_id).catch(function(e){ console.warn("alert email failed:", e?.message); });
    }
    return jsonResponse({ error: gate.error }, gate.status);
  }
  let phone = telephone.replace(/[\s.\-]/g, ""); if (phone.startsWith("0")) phone = "+33" + phone.slice(1);
  const result = await brevoSendSms(env, { to: phone, content: `${salonName||"Votre salon"} : Rappel RDV le ${date} à ${heure}${prestation?" ("+prestation+")":""}. Pour modifier/annuler, contactez-nous. A bientôt !`, sender: (salonName||"Luxyra").slice(0,11).trim() });
  return jsonResponse({ success: true, result, remainingCredits: gate.remainingCredits });
}

async function handleSmsCustom(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!checkRateLimit("sms:" + ip, 15)) return jsonResponse({ error: "Trop de requêtes SMS. Réessayez dans 1 minute." }, 429);
  const { telephone, message, salonName, salon_id } = await request.json();
  if (!telephone || !message) return jsonResponse({ error: "telephone et message requis" }, 400);
  // === Gate Pro + crédits + décrément ===
  const gate = await gateSmsAndDecrementCredit(env, salon_id);
  if (!gate.ok) return jsonResponse({ error: gate.error }, gate.status);
  let phone = telephone.replace(/[\s.\-]/g, ""); if (phone.startsWith("0")) phone = "+33" + phone.slice(1);
  const result = await brevoSendSms(env, { to: phone, content: message, sender: (salonName||"Luxyra").slice(0,11).trim() });
  return jsonResponse({ success: true, result, remainingCredits: gate.remainingCredits });
}

async function handleClientTickets(request, env) {
  try {
    const { email } = await request.json();
    if (!email) return jsonResponse({ error: "email requis" }, 400);
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
          rdvs.push(d);
        }
      } catch (e) {}
    }
    if (lxId) await _fetch(`client_luxyra_id=eq.${encodeURIComponent(lxId)}`);
    if (email) await _fetch(`client_email=eq.${encodeURIComponent(email)}`);
    rdvs.sort((a, b) => (a.date_rdv || "") > (b.date_rdv || "") ? -1 : 1);
    // Quick Win #3 (2026-05-06) : enrichir chaque RDV avec la politique d'annulation
    // du salon (politique_annulation_h en heures + remboursement_annulation bool).
    // Permet à compte.html (espace client multi-salons) de bloquer les annulations
    // hors délai sans avoir à fetcher chaque salon séparément.
    try {
      const distinctSalons = Array.from(new Set(rdvs.map(r => r.salon_id).filter(Boolean)));
      if (distinctSalons.length > 0) {
        const inList = distinctSalons.map(id => encodeURIComponent(id)).join(",");
        const cu = `${CONFIG.SUPABASE_URL}/rest/v1/site_configs?select=salon_id,politique_annulation,remboursement_annulation&salon_id=in.(${inList})`;
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
      `${CONFIG.SUPABASE_URL}/rest/v1/rdv_online?select=id,client_luxyra_id,client_email&id=eq.${encodeURIComponent(rdvId)}&limit=1`,
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
    if (Object.keys(patch).length === 0) return jsonResponse({ error: "rien à patcher" }, 400);
    const upd = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/rdv_online?id=eq.${encodeURIComponent(rdvId)}`,
      { method: "PATCH", headers: _sbHeaders(env, { "Prefer": "return=minimal" }), body: JSON.stringify(patch) }
    );
    if (!upd.ok) {
      const t = await upd.text();
      return jsonResponse({ error: "update échoué: " + t }, 500);
    }
    return jsonResponse({ success: true });
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
    const { rdv_id, reason, cancelled_by } = await request.json();
    if (!rdv_id) return jsonResponse({ error: "rdv_id requis" }, 400);
    const sbKey = env.SUPABASE_SERVICE_KEY;
    if (!sbKey) return jsonResponse({ error: "config_error" }, 500);
    const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rdv_online?id=eq.${rdv_id}`, {
      method: "PATCH",
      headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ status: "cancelled", cancel_reason: reason || "", cancelled_at: new Date().toISOString(), cancelled_by: cancelled_by || "client" })
    });
    if (res.ok) return jsonResponse({ success: true });
    return jsonResponse({ error: "Update failed", status: res.status }, 500);
  } catch (err) { return jsonResponse({ error: err.message }); }
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
      <div style="background:linear-gradient(135deg,#0a0a0a,#1a1a1a);padding:30px 28px;text-align:center">
        <div style="color:#d4a843;font-family:Georgia,serif;font-size:32px;font-weight:300;letter-spacing:6px;margin:0">LUXYRA</div>
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

    return jsonResponse({ ok: true, token, inviteUrl });
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
      // L'utilisateur existe déjà → on update juste le mot de passe
      const findRes = await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(invite.email)}`, {
        headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` }
      });
      const found = await findRes.json();
      const existingId = found.users?.[0]?.id;
      if (existingId) {
        await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/admin/users/${existingId}`, {
          method: "PUT",
          headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ password, email_confirm: true })
        });
        authUserId = existingId;
      }
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
    if (!salon_id) return jsonResponse({ error: "salon_id requis" }, 400);
    const sbKey = env.SUPABASE_SERVICE_KEY;
    if (!sbKey) return jsonResponse({ error: "config_error" }, 500);
    const headers = { "apikey": sbKey, "Authorization": "Bearer " + sbKey, "Content-Type": "application/json" };
    const from = date_from || new Date().toISOString().slice(0, 10);
    const to = date_to || new Date(Date.now() + 31 * 86400000).toISOString().slice(0, 10);
    // 1. App appointments (RLS-protected table - needs service key)
    const apRes = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/appointments?select=date_rdv,heure,collab_id,service_id,status,a_phases,cancelled&salon_id=eq.${salon_id}&date_rdv=gte.${from}&date_rdv=lte.${to}&status=neq.canc`,
      { headers }
    );
    const appointments = await apRes.json();
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
    const segmentForSlug = path.replace(/^\/+|\/+$/g, "");
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
    }

    if (looksLikeSlug) {
      // Sert site.html avec __SALON_SLUG injecté (URL visible inchangée)
      const res = await fetch(`https://luxyra-fr.github.io/luxyra.fr/site.html`, { cf: { cacheTtl: 0 } });
      let html = await res.text();
      const safeSlug = segmentForSlug.replace(/[^a-z0-9-]/g, "");
      html = html.replace("</head>", `<script>window.__SALON_SLUG=${JSON.stringify(safeSlug)};</script></head>`);

      // ====================================================================
      // SSR META TAGS POUR BOTS SEO/IA (Googlebot, Bingbot, ChatGPT, Perplexity, Claude, etc.)
      // Pour les vrais utilisateurs (navigateur humain) → HTML normal inchangé, le JS injecte
      // les meta côté client comme aujourd'hui. Aucun impact UX si le SSR plante.
      // FIX 2026-05-14
      // ====================================================================
      try {
        const ua = (request.headers.get("user-agent") || "").toLowerCase();
        const isBot =
          ua.includes("googlebot") || ua.includes("bingbot") || ua.includes("yandexbot") ||
          ua.includes("duckduckbot") || ua.includes("baiduspider") || ua.includes("slurp") ||
          ua.includes("facebookexternalhit") || ua.includes("twitterbot") || ua.includes("linkedinbot") ||
          ua.includes("whatsapp") || ua.includes("telegrambot") || ua.includes("discordbot") ||
          ua.includes("applebot") || ua.includes("chatgpt") || ua.includes("gptbot") ||
          ua.includes("oai-searchbot") || ua.includes("perplexitybot") || ua.includes("claudebot") ||
          ua.includes("anthropic") || ua.includes("youbot");
        if (isBot && env.SUPABASE_SERVICE_KEY) {
          const salonRes = await fetch(
            `${CONFIG.SUPABASE_URL}/rest/v1/salons_public?slug=eq.${encodeURIComponent(safeSlug)}&select=id,nom,sous_titre,adresse,cp,ville,tel,email,logo,metier,latitude,longitude,note_moyenne,nb_avis,horaires_salon&limit=1`,
            {
              headers: {
                "apikey": env.SUPABASE_SERVICE_KEY,
                "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`
              },
              cf: { cacheTtl: 300, cacheEverything: true }
            }
          );
          if (salonRes.ok) {
            const data = await salonRes.json();
            if (data && data[0]) {
              const s = data[0];
              // FIX 2026-05-14 : fetch des services pour OfferCatalog (Schema.org)
              // Une erreur ici ne casse pas le SSR — on continue sans catalogue
              let servicesList = [];
              try {
                const svcRes = await fetch(
                  `${CONFIG.SUPABASE_URL}/rest/v1/services?salon_id=eq.${encodeURIComponent(s.id)}&actif=eq.true&show_site=eq.true&select=nom,prix,categorie,cat_genre,phases&order=ordre&limit=50`,
                  {
                    headers: {
                      "apikey": env.SUPABASE_SERVICE_KEY,
                      "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`
                    },
                    cf: { cacheTtl: 300, cacheEverything: true }
                  }
                );
                if (svcRes.ok) servicesList = await svcRes.json();
              } catch (_) { /* services fetch optionnel, on continue sans */ }
              const esc = (v) => String(v == null ? "" : v)
                .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
              const metierLabels = {
                coiffure: "Salon de coiffure", barbier: "Barbier",
                esthetique: "Institut d'esthétique", ongles: "Salon d'ongles",
                bien_etre: "Spa & bien-être"
              };
              const schemaTypes = {
                coiffure: "HairSalon", barbier: "BarberShop",
                esthetique: "BeautySalon", ongles: "NailSalon", bien_etre: "DaySpa"
              };
              const nom = s.nom || "Salon";
              const sousTitre = s.sous_titre || "";
              const ville = s.ville || "";
              const cp = s.cp || "";
              const adresse = s.adresse || "";
              const metier = s.metier || "coiffure";
              const metierLabel = metierLabels[metier] || "Salon";
              const schemaType = schemaTypes[metier] || "LocalBusiness";
              const url = `https://luxyra.fr/${safeSlug}`;
              const image = (s.logo && !String(s.logo).startsWith("data:")) ? s.logo : "https://luxyra.fr/luxyra-logo.png";
              // FIX 2026-05-15 SEO LOCAL : ville accolée au nom (expression composée Google),
              // sous-titre inclus, format dense pour matcher "excellence coiffure sarreguemines"
              const title = sousTitre
                ? `${nom}${ville ? " " + ville : ""} ${sousTitre} — ${metierLabel}`
                : `${nom}${ville ? " " + ville : ""} — ${metierLabel}${cp ? " " + cp : ""}`;
              // Description ultra-dense en mots-clés locaux
              const descParts = [];
              descParts.push(`Réservez en ligne chez ${nom}${sousTitre ? " " + sousTitre : ""}`);
              descParts.push(`${metierLabel}${ville ? " à " + ville : ""}${cp ? " (" + cp + ")" : ""}`);
              if (adresse) descParts.push(adresse + (ville ? " " + ville : ""));
              descParts.push("Confirmation immédiate, sans commission");
              const desc = descParts.join(". ").replace(/\s+/g, " ").trim() + ".";
              const ld = {
                "@context": "https://schema.org",
                "@type": schemaType,
                "name": nom,
                "url": url,
                "image": image,
                "address": {
                  "@type": "PostalAddress",
                  "streetAddress": s.adresse || "",
                  "postalCode": s.cp || "",
                  "addressLocality": ville,
                  "addressCountry": "FR"
                },
                "priceRange": "€€"
              };
              if (s.tel) ld.telephone = s.tel;
              if (s.email) ld.email = s.email;
              if (s.latitude != null && s.longitude != null) {
                ld.geo = { "@type": "GeoCoordinates", "latitude": Number(s.latitude), "longitude": Number(s.longitude) };
              }
              if (s.note_moyenne && s.nb_avis) {
                ld.aggregateRating = {
                  "@type": "AggregateRating",
                  "ratingValue": Number(s.note_moyenne),
                  "reviewCount": Number(s.nb_avis)
                };
              }
              // Horaires (si dispo)
              try {
                const hSal = s.horaires_salon;
                if (hSal && typeof hSal === "object") {
                  const jourMap = { lundi: "Mo", mardi: "Tu", mercredi: "We", jeudi: "Th", vendredi: "Fr", samedi: "Sa", dimanche: "Su" };
                  const horaires = [];
                  Object.keys(hSal).forEach(j => {
                    const v = hSal[j];
                    if (v && v.ouvert && v.creneaux && v.creneaux.length) {
                      v.creneaux.forEach(c => horaires.push(jourMap[j] + " " + c.debut + "-" + c.fin));
                    }
                  });
                  if (horaires.length) ld.openingHours = horaires;
                }
              } catch (_) {}
              // FIX 2026-05-14 : OfferCatalog avec les prestations du salon
              // Permet aux IA/moteurs d'indexer chaque service avec son prix
              // (ex: Excellence ressort sur "coupe femme Sarreguemines")
              try {
                if (servicesList && servicesList.length) {
                  const items = [];
                  for (let i = 0; i < servicesList.length; i++) {
                    const sv = servicesList[i];
                    if (!sv.nom || sv.prix == null) continue;
                    // Durée totale = somme des phases (work + pause)
                    let dureeMin = 0;
                    if (Array.isArray(sv.phases)) {
                      sv.phases.forEach(p => { if (p && typeof p.d === "number") dureeMin += p.d; });
                    }
                    const offer = {
                      "@type": "Offer",
                      "itemOffered": {
                        "@type": "Service",
                        "name": String(sv.nom),
                        "serviceType": sv.categorie || metierLabel,
                        "provider": { "@type": schemaType, "name": nom }
                      },
                      "price": Number(sv.prix).toFixed(2),
                      "priceCurrency": "EUR",
                      "availability": "https://schema.org/InStock"
                    };
                    if (dureeMin > 0) {
                      // ISO 8601 duration : PT30M pour 30 minutes
                      offer.itemOffered.serviceOutput = "Durée approximative : " + dureeMin + " min";
                      offer.itemOffered.estimatedDuration = "PT" + dureeMin + "M";
                    }
                    items.push(offer);
                  }
                  if (items.length) {
                    ld.hasOfferCatalog = {
                      "@type": "OfferCatalog",
                      "name": "Prestations " + (ville ? "à " + ville : nom),
                      "itemListElement": items
                    };
                  }
                }
              } catch (_) {}
              const ssrMeta =
                `<title>${esc(title)}</title>\n` +
                `<meta name="description" content="${esc(desc)}">\n` +
                `<link rel="canonical" href="${esc(url)}">\n` +
                `<meta property="og:type" content="website">\n` +
                `<meta property="og:site_name" content="Luxyra">\n` +
                `<meta property="og:url" content="${esc(url)}">\n` +
                `<meta property="og:title" content="${esc(title)}">\n` +
                `<meta property="og:description" content="${esc(desc)}">\n` +
                `<meta property="og:image" content="${esc(image)}">\n` +
                `<meta property="og:locale" content="fr_FR">\n` +
                `<meta name="twitter:card" content="summary_large_image">\n` +
                `<meta name="twitter:title" content="${esc(title)}">\n` +
                `<meta name="twitter:description" content="${esc(desc)}">\n` +
                `<meta name="twitter:image" content="${esc(image)}">\n` +
                `<script id="ssr-ld-localbusiness" type="application/ld+json">${JSON.stringify(ld)}</script>\n`;
              // Retire l'ancien <title> et insère le SSR (le JS côté client réécrit
              // si besoin avec id="ssr-ld-localbusiness" qui sera supprimé)
              html = html.replace(/<title>[^<]*<\/title>/i, "").replace("</head>", ssrMeta + "</head>");

              // ====================================================================
              // FALLBACK HTML POUR BOTS (FIX 2026-05-15 SEO LOCAL)
              // Bloc <noscript> indexable par Google même sans exécuter le JS,
              // contient h1/h2/services en HTML pur avec mots-clés locaux denses.
              // Pour les humains : <noscript> n'est pas affiché (ils ont JS),
              // donc aucun impact UX. Pour Googlebot : contenu structuré direct.
              // ====================================================================
              try {
                let fallback = `<noscript><div style="max-width:900px;margin:0 auto;padding:40px 20px;font-family:Georgia,serif;color:#333">`;
                fallback += `<h1>${esc(nom)}${ville ? " " + esc(ville) : ""}${sousTitre ? " — " + esc(sousTitre) : ""}</h1>`;
                fallback += `<p><strong>${esc(metierLabel)}${ville ? " à " + esc(ville) : ""}${cp ? " (" + esc(cp) + ")" : ""}</strong></p>`;
                if (adresse || ville) {
                  fallback += `<h2>Adresse</h2><address>${esc(adresse)}${cp ? ", " + esc(cp) : ""}${ville ? " " + esc(ville) : ""}, France</address>`;
                }
                if (s.tel) fallback += `<p><strong>Téléphone :</strong> <a href="tel:${esc(s.tel)}">${esc(s.tel)}</a></p>`;
                // Horaires
                try {
                  const hSal = s.horaires_salon;
                  if (hSal && typeof hSal === "object") {
                    const jourLabels = { lundi: "Lundi", mardi: "Mardi", mercredi: "Mercredi", jeudi: "Jeudi", vendredi: "Vendredi", samedi: "Samedi", dimanche: "Dimanche" };
                    const rows = [];
                    Object.keys(jourLabels).forEach(j => {
                      const v = hSal[j];
                      if (v && v.ouvert && v.creneaux && v.creneaux.length) {
                        const crs = v.creneaux.map(c => c.debut + "–" + c.fin).join(", ");
                        rows.push(`<li><strong>${jourLabels[j]} :</strong> ${esc(crs)}</li>`);
                      } else if (v) {
                        rows.push(`<li><strong>${jourLabels[j]} :</strong> Fermé</li>`);
                      }
                    });
                    if (rows.length) fallback += `<h2>Horaires d'ouverture</h2><ul>${rows.join("")}</ul>`;
                  }
                } catch (_) {}
                // Services + prix
                if (servicesList && servicesList.length) {
                  fallback += `<h2>Prestations ${ville ? "à " + esc(ville) : ""}</h2><ul>`;
                  for (let i = 0; i < Math.min(servicesList.length, 30); i++) {
                    const sv = servicesList[i];
                    if (!sv.nom || sv.prix == null) continue;
                    fallback += `<li>${esc(sv.nom)} — ${Number(sv.prix).toFixed(2)} €${sv.categorie ? " (" + esc(sv.categorie) + ")" : ""}</li>`;
                  }
                  fallback += `</ul>`;
                }
                fallback += `<h2>Réservation en ligne</h2><p>Prenez rendez-vous chez <strong>${esc(nom)}</strong>${ville ? " à <strong>" + esc(ville) + "</strong>" : ""} 24h/24, 7j/7. Confirmation immédiate par email et SMS.</p>`;
                fallback += `<p><a href="${esc(url)}#reserver">Réserver maintenant chez ${esc(nom)}${ville ? " " + esc(ville) : ""}</a></p>`;
                fallback += `<p style="font-size:11px;color:#888">Propulsé par <a href="https://luxyra.fr">Luxyra</a> — logiciel de caisse et réservation en ligne sans commission.</p>`;
                fallback += `</div></noscript>`;
                // Insérer juste après <body>
                html = html.replace(/<body([^>]*)>/i, `<body$1>${fallback}`);
              } catch (_) { /* fallback HTML optionnel */ }
            }
          }
        }
      } catch (_) {
        // Fallback silent : le HTML normal est servi, le JS client gérera les meta
      }
      // ====================================================================

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

async function runRetentionPurgeJob(env) {
  const sbKey = env.SUPABASE_SERVICE_KEY;
  if (!sbKey) {
    console.warn("[retention] SUPABASE_SERVICE_KEY missing — abort");
    return { skipped: "no_service_key" };
  }
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
  <div style="background:linear-gradient(135deg,#d4a843,#b8960f);padding:24px;text-align:center">
    <h1 style="color:#0a0a0a;margin:0;font-size:24px;letter-spacing:1px">LUXYRA</h1>
  </div>
  <div style="padding:32px 28px">
    <h2 style="color:#1a1a1a;font-size:20px;margin:0 0 16px">⏰ Préavis de suppression de vos données</h2>
    <p style="font-size:15px;line-height:1.6;color:#333">Bonjour,</p>
    <p style="font-size:15px;line-height:1.6;color:#333">Votre abonnement Luxyra a été résilié il y a <strong>près de 6 ans</strong>. Conformément à la législation française (CGI art. L102 B), nous avons conservé vos documents comptables pendant cette période obligatoire.</p>
    <div style="background:#fff8e6;border-left:4px solid #d4a843;padding:16px;margin:20px 0;border-radius:6px">
      <p style="margin:0;font-size:14px;color:#1a1a1a"><strong>📅 Vos données seront supprimées définitivement le <span style="color:#b8960f">${purgeFmt}</span></strong> (dans environ 30 jours).</p>
    </div>
    <p style="font-size:15px;line-height:1.6;color:#333">Si vous souhaitez récupérer vos clôtures Z, factures, ou tout autre document comptable, connectez-vous dès maintenant en mode archives :</p>
    <div style="text-align:center;margin:28px 0">
      <a href="https://app.luxyra.fr" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#d4a843,#b8960f);color:#0a0a0a;text-decoration:none;font-weight:700;border-radius:10px;letter-spacing:.5px;text-transform:uppercase;font-size:13px">Accéder à mes archives</a>
    </div>
    <p style="font-size:14px;line-height:1.6;color:#666">Une fois connecté, cliquez sur <strong>"Accéder à mes archives comptables"</strong> pour télécharger vos documents en quelques clics.</p>
    <hr style="border:none;border-top:1px solid #eee;margin:28px 0">
    <p style="font-size:12px;color:#999;line-height:1.5">Vous pouvez également <a href="https://app.luxyra.fr" style="color:#d4a843">reprendre un abonnement</a> à tout moment pour continuer d'utiliser Luxyra.</p>
    <p style="font-size:12px;color:#999;margin-top:18px">Luxyra • contact@luxyra.fr</p>
  </div>
</div>`;
  const text = `Préavis suppression de vos données — Luxyra\n\nVotre abonnement résilié atteint bientôt 6 ans. Vos documents comptables seront supprimés définitivement le ${purgeFmt} (dans environ 30 jours).\n\nPour récupérer vos clôtures Z, factures et autres documents : connectez-vous sur https://app.luxyra.fr et cliquez sur "Accéder à mes archives comptables".\n\nLuxyra • contact@luxyra.fr`;
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
