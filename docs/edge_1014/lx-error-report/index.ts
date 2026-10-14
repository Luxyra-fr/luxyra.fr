// lx-error-report v5 — 2026-10-14 SECURITE : la branche « server » (server_errors) n'accepte plus n'importe quelle
//   gravité depuis un appel anonyme : sans clé service, gravité plafonnée à « warning » (« critical » déclenchait
//   des alertes par email), et 20 rapports max / 10 min par adresse IP (empreinte).
// lx-error-report v3 — collecte :
//   - les erreurs JS frontend (audit_log ou js_errors_public selon contexte salon)
//   - les erreurs SERVER (edge functions wrappers) → server_errors
// Déclenché par body.type='edge_function_error' OU body.kind='server' → server_errors

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL")!;
const SB_SR  = Deno.env.get("SB_SERVICE_ROLE") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(SB_URL, SB_SR, { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(s: number, b: unknown) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
}

async function hashIp(ip: string): Promise<string> {
  try {
    const enc = new TextEncoder().encode(ip + "|luxyra_salt_2026");
    const hash = await crypto.subtle.digest("SHA-256", enc);
    return Array.from(new Uint8Array(hash)).slice(0, 8).map(b => b.toString(16).padStart(2, "0")).join("");
  } catch { return "unknown"; }
}
function egal(a: string, b: string): boolean { if (!a || a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
// Appel serveur = la clé service est présentée (en-tête Authorization ou apikey)
function appelServeur(req: Request): boolean {
  const auth = String(req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const key = String(req.headers.get("apikey") || "").trim();
  return egal(auth, SB_SR) || egal(key, SB_SR);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const body = await req.json().catch(() => null);
    if (!body) return json(400, { error: "Invalid JSON" });
    const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "";
    const ip_hash = ip ? await hashIp(ip) : null;

    // ====================================================================
    // BRANCHE 1 : Erreurs SERVER (edge functions wrapper)
    // ====================================================================
    if (body.kind === "server" || body.type === "edge_function_error") {
      const serveur = appelServeur(req);
      const source = String(body.source || "edge:unknown").slice(0, 100);
      let severity = (body.severity === "critical" || body.severity === "error" || body.severity === "warning") ? body.severity : "error";
      if (!serveur) {
        severity = "warning"; // 2026-10-14 : jamais « error » / « critical » depuis un navigateur
        if (ip_hash) {
          const depuis = new Date(Date.now() - 10 * 60 * 1000).toISOString();
          const { count } = await sb.from("server_errors").select("id", { count: "exact", head: true }).eq("ip_hash", ip_hash).gte("reported_at", depuis);
          if ((count || 0) >= 20) return json(429, { ok: false, error: "rate_limited" });
        }
      }
      const message = String(body.message || "").slice(0, 800);
      const stack = body.stack ? String(body.stack).slice(0, 2000) : null;
      const httpPath = body.http_path ? String(body.http_path).slice(0, 300) : null;
      const httpStatus = body.http_status != null ? Number(body.http_status) : null;
      const salonId = (body.salon_id && /^[0-9a-f-]{36}$/i.test(String(body.salon_id))) ? body.salon_id : null;

      const { error } = await sb.from("server_errors").insert({
        source: serveur ? source : ("public:" + source).slice(0, 100),
        severity,
        message: message + (stack ? "\n" + stack.slice(0, 600) : ""),
        http_path: httpPath,
        http_status: httpStatus,
        salon_id: salonId,
        ip_hash: serveur ? null : ip_hash,
      });
      if (error) return json(500, { error: error.message });
      return json(200, { ok: true, target: "server_errors", source, severity });
    }

    // ====================================================================
    // BRANCHE 2 : Erreurs JS FRONTEND (audit_log ou js_errors_public)
    // ====================================================================
    const payload = {
      type: String(body.type || "error").slice(0, 50),
      message: String(body.message || "").slice(0, 800),
      stack: body.stack ? String(body.stack).slice(0, 3000) : null,
      file: body.file ? String(body.file).slice(0, 300) : null,
      line: body.line != null ? Number(body.line) : null,
      col: body.col != null ? Number(body.col) : null,
      page: String(body.page || "").slice(0, 300),
      salon_slug: body.salon_slug ? String(body.salon_slug).slice(0, 80) : null,
      ua: String(body.ua || "").slice(0, 400),
      url: body.url ? String(body.url).slice(0, 500) : null,
      ts: body.ts || new Date().toISOString(),
    };

    const skipPatterns = [
      /ResizeObserver loop/i, /Script error\.?$/i, /Non-Error promise rejection/i,
      /Network request failed/i, /Load failed/i, /^TypeError: cancelled/i, /^AbortError/i
    ];
    if (skipPatterns.some(p => p.test(payload.message))) {
      return json(200, { ok: true, skipped: "benign_pattern" });
    }

    let salon_id: string | null = null;
    if (payload.salon_slug) {
      const { data: salon } = await sb.from("salons_public").select("id").eq("slug", payload.salon_slug).maybeSingle();
      if (salon) salon_id = salon.id;
    }

    let source = "other";
    if (payload.page.includes("/app") || payload.page.endsWith("app.html")) source = "app";
    else if (payload.page.includes("/admin")) source = "admin";
    else if (payload.page.includes("/inscription")) source = "inscription";
    else if (payload.page.includes("/compte")) source = "compte";
    else if (payload.page.includes("/bons-cadeaux")) source = "bons_cadeaux";
    else if (payload.page.includes("/tarifs")) source = "tarifs";
    else if (payload.page.includes("/pro")) source = "pro";
    else if (payload.page.includes("/recherche")) source = "recherche";
    else if (payload.page === "/" || payload.page.endsWith("/index.html")) source = "index";
    else if (payload.salon_slug) source = "site_salon";
    else if (payload.page.includes("/migration")) source = "migration";

    if (salon_id) {
      const details = JSON.stringify({
        source, type: payload.type, msg: payload.message,
        file: payload.file, line: payload.line, col: payload.col,
        stack: payload.stack ? payload.stack.slice(0, 1500) : null,
        page: payload.page, salon_slug: payload.salon_slug,
        url: payload.url, ua: payload.ua, ts: payload.ts
      }).slice(0, 3000);
      const action = source === "app" ? "JS_ERROR" : (source === "admin" ? "JS_ERROR" : "JS_ERROR_PUBLIC");
      const { error } = await sb.from("audit_log").insert({
        salon_id, action, details, operator_name: "public_monitoring"
      });
      if (error) return json(500, { error: error.message });
      return json(200, { ok: true, salon_id, source, target: "audit_log" });
    }

    const { error } = await sb.from("js_errors_public").insert({
      source, type: payload.type, message: payload.message, stack: payload.stack,
      file: payload.file, line: payload.line, col: payload.col,
      page: payload.page, url: payload.url, salon_slug: payload.salon_slug,
      ua: payload.ua, ip_hash
    });
    if (error) {
      console.warn("[lx-error-report] js_errors_public insert failed:", error.message);
      return json(500, { error: error.message });
    }
    return json(200, { ok: true, source, target: "js_errors_public" });
  } catch (e) {
    console.error("[lx-error-report] exception:", e);
    return json(500, { error: String((e as Error)?.message || e) });
  }
});
