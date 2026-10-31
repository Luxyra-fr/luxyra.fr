// gc-create-checkout v6 — 2026-10-28 (-2, Luxyra 6.8.0) : recettes en ligne en caisse.
//  - ht / tva / tva_rate du bon calculés au taux RÉEL de l'établissement (avant : 20 % codés en dur, faux en franchise de TVA
//    ou à un autre taux). Quand le modèle bons v2 est actif (app_config.config.bons_tva_v2), le déclencheur
//    a_cartes_cadeaux_qualifier (docs/migrations_1027/bons_cadeaux_tva.sql) qualifie le bon (BUU / BUM, CGI art. 256 ter) et
//    remplace ces valeurs ; le ticket de caisse de la vente est créé au paiement confirmé (gc-stripe-webhook v9 +
//    docs/migrations_1028/recettes_en_ligne.sql).
//  - Refus explicite tant que les recettes en ligne ne sont pas enregistrées en caisse par le serveur
//    (app_config.config.recettes_en_ligne_serveur ≠ true) : un bon payé en ligne sans ticket de caisse est exactement le
//    défaut corrigé (C1). Contrôle en plus de salons.bons_cadeaux_online_actif.
// v5 — 2026-10-09 : CHARGES DIRECTES. Si app_config.stripe_charges_directes = true,
// la session est créée SUR le compte Stripe du salon (Stripe-Account) : frais et litiges chez le salon,
// rien ne transite par le compte Luxyra. Sinon, ancien mode (destination). v4 : log server_errors.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL")!;
const SB_SR  = Deno.env.get("SB_SERVICE_ROLE") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET = Deno.env.get("STRIPE_SECRET_KEY") || "";
const sb = createClient(SB_URL, SB_SR, { auth: { persistSession: false } });

const VALID_THEMES = new Set(["luxeNoir","noel","stValentin","feteMeres","anniversaire","roseGold","printemps","ete","classique","midnight"]);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(s:number,b:unknown){ return new Response(JSON.stringify(b),{status:s,headers:{...CORS,"Content-Type":"application/json"}}); }

async function reportErr(message: string, severity: "warning"|"error"|"critical", err?: Error, context?: unknown) {
  try { await sb.rpc("report_server_error", { p_source: "edge_fn:gc-create-checkout", p_message: message.slice(0,800), p_severity: severity, p_stack: err?.stack ? err.stack.slice(0,3000) : null, p_context: context ? (context as Record<string,unknown>) : null }); }
  catch (e) { console.error("[reportErr] failed:", e); }
}
async function lireConfig(): Promise<Record<string, unknown>> {
  try { const { data } = await sb.from("app_config").select("config").eq("id", 1).maybeSingle(); return ((data as any) && (data as any).config) || {}; }
  catch { return {}; }
}
// HT / TVA d'un bon au taux de l'établissement (arrondi au centime comme l'application : Math.round)
export function lxBonHtTva(valeur: number, tauxSalon: number | null | undefined): { ht: number; tva: number; tva_rate: number } {
  const t = (tauxSalon === null || tauxSalon === undefined || isNaN(Number(tauxSalon))) ? 20 : Number(tauxSalon);
  const ht = Math.round(valeur / (1 + t / 100) * 100) / 100;
  return { ht, tva: Math.round((valeur - ht) * 100) / 100, tva_rate: t / 100 };
}

function genBonCode() {
  const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  let c = "";
  for (let i=0; i<6; i++) c += chars.charAt(Math.floor(Math.random()*chars.length));
  return "BC-" + c;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  try {
    if (!STRIPE_SECRET || !(STRIPE_SECRET.startsWith("sk_test_") || STRIPE_SECRET.startsWith("sk_live_"))) {
      await reportErr("STRIPE_SECRET_KEY mal configuré", "critical");
      return json(503, { error: "Paiement temporairement indisponible (configuration serveur)." });
    }
    const body = await req.json().catch(() => null);
    if (!body) return json(400, { error: "Invalid JSON" });
    const salon_id = String(body.salon_id || "").trim();
    const salon_slug = String(body.salon_slug || "").trim();
    const amount = Number(body.amount || 0);
    // 2026-10-31 (contre-audit H1) : texte libre de l'acheteur nettoyé (ni balise ni caractère de contrôle)
    const nettoie = (x: unknown, n: number) => String(x || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F<>]/g, "").replace(/\s+\n/g, "\n").trim().slice(0, n);
    const de = nettoie(body.de, 80);
    const pour = nettoie(body.pour, 80);
    const message = nettoie(body.message, 280);
    const buyer_email = String(body.buyer_email || "").trim().toLowerCase();
    const buyer_phone = String(body.buyer_phone || "").trim().slice(0, 20);
    const return_url = String(body.return_url || "").trim();
    const theme_id_raw = String(body.theme_id || "classique").trim();
    const theme_id = VALID_THEMES.has(theme_id_raw) ? theme_id_raw : "classique";

    if (!salon_id || salon_id.length !== 36) return json(400, { error: "salon_id invalide" });
    if (!amount || amount < 10 || amount > 2000) return json(400, { error: "Montant invalide (10–2000 €)" });
    if (!de || de.length < 2) return json(400, { error: "Le champ 'Offert par' est requis" });
    if (!message || message.length < 2) return json(400, { error: "Le message est requis" });
    if (!buyer_email || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(buyer_email)) return json(400, { error: "Email invalide" });
    if (!return_url || !/^https:\/\//i.test(return_url)) return json(400, { error: "return_url invalide" });

    const cfg = await lireConfig();
    // 2026-10-28 (-2) : jamais de bon vendu en ligne sans ticket de caisse au paiement (constat C1)
    if (cfg.recettes_en_ligne_serveur !== true) {
      return json(403, { error: "La vente de bons cadeaux en ligne est momentanément indisponible. Achetez votre bon en boutique.", code: "recettes_en_ligne_inactives" });
    }

    const { data: salon, error: salonErr } = await sb.from("salons")
      .select("id, nom, status, stripe_connect_id, stripe_connect_status, slug, bons_cadeaux_online_actif, taux_tva")
      .eq("id", salon_id).maybeSingle();
    if (salonErr || !salon) return json(404, { error: "Salon introuvable" });
    if (salon.status === "suspended" || salon.status === "cancelled") {
      return json(403, { error: "Ce salon n'est plus actif" });
    }
    if (!salon.bons_cadeaux_online_actif) {
      return json(403, { error: "Ce salon ne propose pas de bons cadeaux en ligne. Achetez en boutique.", code: "bons_cadeaux_disabled" });
    }
    if (!salon.stripe_connect_id) {
      return json(403, { error: "Ce salon n'a pas activé les paiements en ligne.", code: "no_connect" });
    }
    if (salon.stripe_connect_status !== "active" && salon.stripe_connect_status !== "enabled") {
      return json(403, { error: "Les paiements en ligne sont en cours d'activation.", code: "connect_pending" });
    }
    const direct = cfg.stripe_charges_directes === true;

    let bonCode = genBonCode();
    let tries = 0;
    while (tries < 5) {
      const { data: dup } = await sb.from("cartes_cadeaux").select("id").eq("salon_id", salon_id).eq("code", bonCode).limit(1).maybeSingle();
      if (!dup) break;
      bonCode = genBonCode();
      tries++;
    }

    const exp = new Date(); exp.setFullYear(exp.getFullYear() + 1);
    const expStr = exp.toISOString().slice(0, 10);
    const _ht = lxBonHtTva(amount, salon.taux_tva);

    const insertData: Record<string, unknown> = {
      salon_id, valeur: amount, restant: amount,
      de, pour, message, code: bonCode, date_expiration: expStr,
      status: "active", scope: "tout", pay_method: "CB en ligne", is_offert: false,
      ht: _ht.ht, tva: _ht.tva, tva_rate: _ht.tva_rate,
      source: "web", payment_status: "pending",
      buyer_email, buyer_phone: buyer_phone || null,
      theme_id,
      stripe_account: direct ? salon.stripe_connect_id : null
    };
    const { data: bcRow, error: insErr } = await sb.from("cartes_cadeaux").insert(insertData).select("id, code").single();
    if (insErr || !bcRow) {
      console.error("Insert pending bon cadeau échec", insErr);
      await reportErr("Insert cartes_cadeaux pending échec: " + (insErr?.message || "unknown"), "critical", undefined, { salon_id, code: insErr?.code });
      return json(500, { error: "Erreur création bon : " + (insErr?.message || "unknown") });
    }

    const amountCents = Math.round(amount * 100);
    const params = new URLSearchParams();
    params.append("mode", "payment");
    params.append("payment_method_types[]", "card");
    params.append("line_items[0][price_data][currency]", "eur");
    params.append("line_items[0][price_data][product_data][name]", `Bon cadeau ${amount} € — ${salon.nom}`);
    params.append("line_items[0][price_data][product_data][description]", `Offert par ${de}${pour ? " à " + pour : ""}`);
    params.append("line_items[0][price_data][unit_amount]", String(amountCents));
    params.append("line_items[0][quantity]", "1");
    params.append("customer_email", buyer_email);
    params.append("success_url", return_url + "?session_id={CHECKOUT_SESSION_ID}");
    params.append("cancel_url", (salon_slug ? `https://luxyra.fr/${salon_slug}/bons-cadeaux` : return_url));
    params.append("locale", "fr");
    if (!direct) {
      params.append("payment_intent_data[application_fee_amount]", "0");
      params.append("payment_intent_data[transfer_data][destination]", salon.stripe_connect_id);
    }
    params.append("payment_intent_data[description]", `Bon cadeau ${bcRow.code} — ${salon.nom}`);
    params.append("metadata[type]", "bon_cadeau");
    params.append("metadata[salon_id]", salon_id);
    params.append("metadata[bc_id]", bcRow.id);
    params.append("metadata[bc_code]", bcRow.code);
    params.append("metadata[salon_slug]", salon_slug);

    const headers: Record<string,string> = { "Authorization": `Bearer ${STRIPE_SECRET}`, "Content-Type": "application/x-www-form-urlencoded" };
    if (direct) headers["Stripe-Account"] = salon.stripe_connect_id;
    const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers, body: params.toString() });
    const stripeData = await stripeRes.json();
    if (!stripeRes.ok || !stripeData.url) {
      console.error("Stripe session creation failed", stripeData);
      await reportErr("Stripe checkout/sessions creation failed: " + JSON.stringify(stripeData.error || stripeData).slice(0,500), "critical", undefined, { salon_id, bc_id: bcRow.id, direct });
      await sb.from("cartes_cadeaux").delete().eq("id", bcRow.id);
      return json(502, { error: stripeData.error?.message || "Erreur création paiement Stripe" });
    }
    await sb.from("cartes_cadeaux").update({ stripe_session_id: stripeData.id }).eq("id", bcRow.id);
    return json(200, { ok: true, url: stripeData.url, session_id: stripeData.id, bc_id: bcRow.id, bc_code: bcRow.code });
  } catch (e) {
    const err = e as Error;
    console.error("gc-create-checkout unexpected", err);
    await reportErr("Exception non gérée: " + (err?.message || String(e)), "critical", err);
    return json(500, { error: String(err?.message || e) });
  }
});
