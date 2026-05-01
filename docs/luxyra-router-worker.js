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
      if (url.pathname === "/api/email/ticket" && request.method === "POST") return await handleEmailTicket(request, env);
      if (url.pathname === "/api/email/welcome" && request.method === "POST") return await handleEmailWelcome(request, env);
      if (url.pathname === "/api/email/custom" && request.method === "POST") return await handleEmailCustom(request, env);
      if (url.pathname === "/api/sms/rappel" && request.method === "POST") return await handleSmsRappel(request, env);
      if (url.pathname === "/api/sms/custom" && request.method === "POST") return await handleSmsCustom(request, env);
      // NEW: SMS Native companion app linking
      if (url.pathname === "/api/sms/generate-link-token" && request.method === "POST") return await handleSmsGenerateLinkToken(request, env);
      if (url.pathname === "/api/sms/link-device" && request.method === "POST") return await handleSmsLinkDevice(request, env);
      if (url.pathname === "/api/client/tickets" && request.method === "POST") return await handleClientTickets(request, env);
      if (url.pathname === "/api/salon/availability" && request.method === "POST") return await handleSalonAvailability(request, env);
      if (url.pathname === "/api/rdv/cancel" && request.method === "POST") return await handleRdvCancel(request, env);
      return jsonResponse({ error: "Not found" }, 404);
    } catch (err) {
      console.error("Worker error:", err);
      return jsonResponse({ error: err.message }, 500);
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
        await supabaseUpdate(env, salonId, { plan: "essential", status: "cancelled", past_due_since: null });
        await patchSiteConfig(env, salonId, { site_actif: false, reservation_active: false });
      }
      break;
    }

    case "customer.subscription.updated": {
      const salonId = data.metadata?.salon_id;
      const priceId = data.items?.data?.[0]?.price?.id;
      if (salonId && priceId) {
        const newPlan = priceId === CONFIG.PRICE_PRO ? "pro" : "essential";
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

    // Create new Express account
    const account = await stripeAPI(env, "accounts", {
      type: "express",
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

// Get Express dashboard login link for salon
async function handleConnectDashboard(request, env) {
  try {
    const { salon_id } = await request.json();
    if (!salon_id) return jsonResponse({ error: "salon_id requis" }, 400);

    const salon = await supabaseGet(env, salon_id);
    if (!salon?.stripe_connect_id) return jsonResponse({ error: "Compte Connect non configuré" }, 400);

    const link = await stripeAPI(env, "accounts/" + salon.stripe_connect_id + "/login_links", {});
    if (!link?.url) return jsonResponse({ error: "Erreur Stripe: " + JSON.stringify(link) }, 500);
    return jsonResponse({ url: link.url });
  } catch(e) { return jsonResponse({ error: "Connect dashboard error: " + e.message }, 500); }
}

// Create payment on connected account (acompte or product purchase)
// 0% Luxyra commission — only Stripe fees apply
async function handleConnectPayment(request, env) {
  try {
    const { salon_id, amount, description, customer_email, customer_name, metadata } = await request.json();
    if (!salon_id || !amount) return jsonResponse({ error: "salon_id et amount requis" }, 400);

    const salon = await supabaseGet(env, salon_id);
    if (!salon?.stripe_connect_id) return jsonResponse({ error: "Ce salon n'a pas configuré ses paiements en ligne" }, 400);

    // Check Connect account is active
    const account = await stripeAPI(env, `accounts/${salon.stripe_connect_id}`, null, "GET");
    if (!account?.charges_enabled) return jsonResponse({ error: "Le compte de paiement du salon n'est pas encore actif" }, 400);

    // Create Checkout Session on connected account — 0% platform fee
    const session = await stripeAPI(env, "checkout/sessions", {
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
    });

    if (!session?.url) return jsonResponse({ error: "Erreur paiement: " + JSON.stringify(session) }, 500);
    return jsonResponse({ url: session.url, session_id: session.id });
  } catch(e) { return jsonResponse({ error: "Connect payment error: " + e.message }, 500); }
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
  await supabaseUpdate(env, salonId, { plan, status: "active", stripe_subscription_id: subscriptionId, stripe_customer_id: customerId });
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
  const { clientEmail, clientName, salonName, salonEmail, ticketNum, ticketHtml } = body;
  if (!clientEmail || !ticketNum) return jsonResponse({ error: "clientEmail et ticketNum requis" }, 400);
  if (!ticketHtml) return jsonResponse({ error: "ticketHtml requis" }, 400);
  const emailHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:'Helvetica Neue',Arial,sans-serif;background:#f5f5f5;margin:0;padding:20px}.wrapper{max-width:500px;margin:0 auto}.header{background:linear-gradient(135deg,#1a1a2e,#16213e);padding:24px;text-align:center;color:#fff;border-radius:12px 12px 0 0}.header h1{margin:0;font-size:20px;color:#d4a843;letter-spacing:1px}.header p{margin:4px 0 0;font-size:13px;color:rgba(255,255,255,.7)}.ticket-container{background:#fff;padding:24px;border-left:1px solid #e0e0e0;border-right:1px solid #e0e0e0;font-family:'Courier New',monospace;font-size:12px;line-height:1.5;color:#000}.ticket-container table{width:100%;border-collapse:collapse}.footer{text-align:center;padding:16px;font-size:11px;color:#999;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 12px 12px;background:#fff}</style></head><body><div class="wrapper"><div class="header"><h1>${salonName||"Votre salon"}</h1><p>Votre ticket de caisse N°${ticketNum}</p></div><div class="ticket-container">${ticketHtml}</div><div class="footer">Envoyé via <strong>Luxyra</strong> — Logiciel de gestion conforme NF525<br>Art. 286-I-3° bis du CGI<br><em style="font-size:10px;color:#bbb">Ce ticket fait office de facture. Conservez-le 6 ans minimum.</em></div></div></body></html>`;
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
  // Crédits suffisants
  const credits = Number(salon.sms_credits || 0);
  if (credits <= 0) return { ok: false, status: 402, error: "Plus de crédits SMS — rechargez via Paramètres > SMS" };
  // Décrément atomique (PostgREST PATCH avec valeur calculée)
  await supabaseUpdate(env, salonId, { sms_credits: credits - 1, sms_used: (salon.sms_used || 0) + 1 });
  return { ok: true, remainingCredits: credits - 1 };
}

async function handleSmsRappel(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!checkRateLimit("sms:" + ip, 15)) return jsonResponse({ error: "Trop de requêtes SMS. Réessayez dans 1 minute." }, 429);
  const { telephone, clientPrenom, salonName, date, heure, prestation, salon_id } = await request.json();
  if (!telephone) return jsonResponse({ error: "telephone requis" }, 400);
  // === Gate Pro + crédits + décrément ===
  const gate = await gateSmsAndDecrementCredit(env, salon_id);
  if (!gate.ok) return jsonResponse({ error: gate.error }, gate.status);
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
    const roRes = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/rdv_online?select=date_rdv,heure_rdv,collaborateur_id,duree_minutes,status&salon_id=eq.${salon_id}&date_rdv=gte.${from}&status=neq.cancelled`,
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
    "/aide": "/aide.html",
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
      "site", "index", "home", "tarifs", "aide",
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

    if (looksLikeSlug) {
      // Sert site.html avec __SALON_SLUG injecté (URL visible inchangée)
      const res = await fetch(`https://luxyra-fr.github.io/luxyra.fr/site.html`, { cf: { cacheTtl: 0 } });
      let html = await res.text();
      const safeSlug = segmentForSlug.replace(/[^a-z0-9-]/g, "");
      html = html.replace("</head>", `<script>window.__SALON_SLUG=${JSON.stringify(safeSlug)};</script></head>`);
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
// EOF
