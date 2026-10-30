// Harnais : PostgREST simulé sur la base PGlite (reconstruite depuis la production), Stripe et Brevo simulés,
// edge functions (Deno simulé) et worker (bundle esbuild) branchés sur le même fetch.
import { commeRole } from "./base.mjs";

export const SERVICE = "cle-service-de-test";
export const ANON = "cle-anon-de-test";
const SB = "https://kxdgjtvrkwugbifgppai.supabase.co";

export function creerMonde(db) {
  const monde = { db, emails: [], sms: [], stripe: { sessions: new Map(), refunds: [], idem: new Map(), expirees: [], n: 0, refuserRefund: false }, jwts: new Map(), appelsWorker: [], edge: {}, worker: null, brevoKo: false };
  const realFetch = globalThis.fetch;

  function json(status, body, extra) { return new Response(body === undefined ? "" : JSON.stringify(body), { status, headers: Object.assign({ "Content-Type": "application/json" }, extra || {}) }); }
  function roleDe(headers) {
    const a = String(headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (a === SERVICE || headers.get("apikey") === SERVICE && !a) return { role: "service_role" };
    if (monde.jwts.has(a)) return { role: "authenticated", sub: monde.jwts.get(a).id };
    return { role: "anon" };
  }
  function ident(s) { if (!/^[a-z_][a-z0-9_]*$/i.test(s)) throw new Error("identifiant refusé " + s); return '"' + s + '"'; }
  function cond(col, op, val, params) {
    const c = ident(col);
    if (op === "is") return `${c} is ${val === "null" ? "null" : val === "true" ? "true" : "false"}`;
    if (op === "in") { const vals = val.replace(/^\(|\)$/g, "").split(",").map((v) => v.replace(/^"|"$/g, "")); return `${c}::text in (${vals.map((v) => { params.push(v); return "$" + params.length; }).join(",")})`; }
    const m = { eq: "=", neq: "<>", lt: "<", lte: "<=", gt: ">", gte: ">=", like: "like", ilike: "ilike" }[op];
    if (!m) throw new Error("opérateur " + op);
    params.push(op.endsWith("like") ? val.replace(/\*/g, "%") : val);
    return `${c} ${m} $${params.length}`;
  }
  function filtres(sp, params) {
    const w = [];
    for (const [k, v] of sp.entries()) {
      if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(k)) continue;
      if (k === "or") {
        const parts = v.replace(/^\(|\)$/g, "").split(",").map((p) => { const i = p.indexOf("."), j = p.indexOf(".", i + 1); return cond(p.slice(0, i), p.slice(i + 1, j), p.slice(j + 1), params); });
        w.push("(" + parts.join(" or ") + ")"); continue;
      }
      const i = v.indexOf(".");
      w.push(cond(k, v.slice(0, i), v.slice(i + 1), params));
    }
    return w.length ? " where " + w.join(" and ") : "";
  }
  async function rest(req, url) {
    const who = roleDe(req.headers);
    const path = url.pathname.replace(/^\/rest\/v1\//, "");
    const sp = url.searchParams;
    const accept = req.headers.get("accept") || "";
    const prefer = req.headers.get("prefer") || "";
    const run = (sql, params) => commeRole(db, who.role, who.sub, () => db.query(sql, params));
    try {
      if (path.startsWith("rpc/")) {
        const nom = path.slice(4); const body = await req.json().catch(() => ({}));
        const keys = Object.keys(body || {}); const params = keys.map((k) => { const v = body[k]; return v === null || v === undefined ? null : (typeof v === "object" ? JSON.stringify(v) : String(v)); });
        const r = await run(`select public.${ident(nom)}(${keys.map((k, i) => `${ident(k)} := $${i + 1}`).join(", ")}) as r`, params);
        return json(200, r.rows[0] ? r.rows[0].r : null);
      }
      const table = ident(path);
      if (req.method === "GET") {
        const params = []; const sel = (sp.get("select") || "*").split(",").map((c) => c === "*" ? "*" : ident(c.trim())).join(", ");
        let sql = `select ${sel} from ${table}` + filtres(sp, params);
        if (sp.get("order")) sql += " order by " + sp.get("order").split(",").map((o) => { const [c, d] = o.split("."); return ident(c) + (d === "desc" ? " desc" : " asc"); }).join(", ");
        if (sp.get("limit")) sql += " limit " + Number(sp.get("limit"));
        const r = await run(sql, params);
        if (/vnd\.pgrst\.object/.test(accept)) return r.rows.length === 1 ? json(200, r.rows[0]) : json(406, { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" });
        return json(200, r.rows);
      }
      if (req.method === "PATCH" || req.method === "POST" || req.method === "DELETE") {
        const body = req.method === "DELETE" ? null : await req.json();
        const params = [];
        let sql;
        if (req.method === "PATCH") {
          const set = Object.keys(body).map((k) => { const v = body[k]; params.push(v === null ? null : typeof v === "object" ? JSON.stringify(v) : String(v)); return `${ident(k)} = $${params.length}`; });
          sql = `update ${table} set ${set.join(", ")}` + filtres(sp, params);
        } else if (req.method === "DELETE") {
          sql = `delete from ${table}` + filtres(sp, params);
        } else {
          const rows = Array.isArray(body) ? body : [body]; const cols = Object.keys(rows[0]);
          const vals = rows.map((row) => "(" + cols.map((k) => { const v = row[k]; params.push(v === null || v === undefined ? null : typeof v === "object" ? JSON.stringify(v) : String(v)); return "$" + params.length; }).join(",") + ")");
          sql = `insert into ${table} (${cols.map(ident).join(",")}) values ${vals.join(",")}`;
          if (/merge-duplicates/.test(prefer) && sp.get("on_conflict")) sql += ` on conflict (${ident(sp.get("on_conflict"))}) do update set ` + cols.map((c) => `${ident(c)} = excluded.${ident(c)}`).join(", ");
        }
        sql += " returning *";
        const r = await run(sql, params);
        if (/vnd\.pgrst\.object/.test(accept)) return r.rows.length === 1 ? json(req.method === "POST" ? 201 : 200, r.rows[0]) : json(406, { message: "0 ou plusieurs lignes", code: "PGRST116" });
        if (/return=representation/.test(prefer) || /vnd\.pgrst\.object/.test(accept)) return json(req.method === "POST" ? 201 : 200, r.rows);
        return new Response(null, { status: req.method === "POST" ? 201 : 204 });
      }
      return json(405, { message: "méthode" });
    } catch (e) {
      const st = /permission denied/.test(e.message) ? 401 : (e.code === "23505" ? 409 : 400);
      return json(st, { message: e.message, code: e.code, hint: e.hint || null, details: e.detail || null });
    }
  }
  async function stripe(req, url) {
    const ep = url.pathname.replace(/^\/v1\//, "");
    const idem = req.headers.get("idempotency-key");
    if (idem && monde.stripe.idem.has(idem)) return json(200, monde.stripe.idem.get(idem));
    const body = req.method === "POST" ? Object.fromEntries(new URLSearchParams(await req.text())) : {};
    const compte = req.headers.get("stripe-account") || null;
    let out;
    if (/^events\//.test(ep)) { const ev = (monde.stripe.events || {})[ep.split("/")[1]]; if (!ev) return json(404, { error: { message: "No such event" } }); out = ev; }
    else if (/^accounts\//.test(ep)) out = { id: ep.split("/")[1], charges_enabled: true };
    else if (ep === "checkout/sessions" && req.method === "POST") {
      const id = "cs_test_" + (++monde.stripe.n);
      const md = {}; for (const [k, v] of Object.entries(body)) { const m = /^metadata\[(.+)\]$/.exec(k); if (m) md[m[1]] = v; }
      out = { id, object: "checkout.session", url: "https://checkout.stripe.test/" + id, status: "open", payment_status: "unpaid", metadata: md, amount_total: Number(body["line_items[0][price_data][unit_amount]"]), payment_intent: null, expires_at: Number(body.expires_at) || null, compte, success_url: body.success_url, params: body };
      monde.stripe.sessions.set(id, out);
    } else if (/^checkout\/sessions\/[^/]+\/expire$/.test(ep)) {
      const s = monde.stripe.sessions.get(decodeURIComponent(ep.split("/")[2]));
      if (!s) return json(404, { error: { message: "No such session" } });
      if (s.status !== "open") return json(400, { error: { message: "Only Checkout Sessions with a status of open can be expired." } });
      s.status = "expired"; monde.stripe.expirees.push(s.id); out = s;
    } else if (/^checkout\/sessions\/[^/]+$/.test(ep)) {
      const s = monde.stripe.sessions.get(decodeURIComponent(ep.split("/")[2]));
      if (!s) return json(404, { error: { message: "No such session" } });
      out = s;
    } else if (ep === "refunds" && req.method === "POST") {
      if (monde.stripe.refuserRefund) return json(400, { error: { message: "refus simulé" } });
      out = { id: "re_test_" + (monde.stripe.refunds.length + 1), object: "refund", status: "succeeded", payment_intent: body.payment_intent, metadata: { motif: body["metadata[motif]"] }, compte };
      monde.stripe.refunds.push(out);
    } else return json(404, { error: { message: "endpoint simulé absent : " + ep } });
    if (idem) monde.stripe.idem.set(idem, out);
    return json(200, out);
  }
  monde.payer = (id, montant) => { const s = monde.stripe.sessions.get(id); s.status = "complete"; s.payment_status = "paid"; s.payment_intent = "pi_" + id; if (montant) s.amount_total = montant; return s; };

  globalThis.fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url);
    if (url.origin === SB && url.pathname.startsWith("/rest/v1/")) return rest(req, url);
    if (url.origin === SB && url.pathname === "/auth/v1/user") {
      const a = String(req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      const u = monde.jwts.get(a); return u ? json(200, u) : json(401, { message: "invalid JWT" });
    }
    if (url.origin === SB && url.pathname.startsWith("/auth/v1/admin/users")) return json(req.headers.get("apikey") === SERVICE ? 200 : 401, { users: [] });
    if (url.hostname === "api.stripe.com") return stripe(req, url);
    if (url.hostname === "api.brevo.com") {
      const b = await req.json().catch(() => ({}));
      if (/smtp\/email/.test(url.pathname)) { if (monde.brevoKo) return json(400, { code: "invalid" }); monde.emails.push(b); return json(201, { messageId: "<m" + monde.emails.length + "@brevo>" }); }
      if (/transactionalSMS/.test(url.pathname)) { monde.sms.push(b); return json(201, { messageId: 1, reference: "r", smsCount: 1 }); }
      return json(200, {});
    }
    if (url.hostname === "luxyra.fr" && url.pathname.startsWith("/api/")) { monde.appelsWorker.push(url.pathname); return monde.worker.fetch(req, monde.env, { waitUntil() {} }); }
    if (url.origin === SB && url.pathname.startsWith("/functions/v1/")) return json(200, { ok: true });
    throw new Error("fetch non simulé : " + req.url);
  };
  monde.restaurer = () => { globalThis.fetch = realFetch; };
  monde.env = { SUPABASE_SERVICE_KEY: SERVICE, STRIPE_SECRET_KEY: "sk_test_x", BREVO_API_KEY: "brevo_test" };
  return monde;
}

// charge une edge function (bundle esbuild) avec un Deno simulé ; renvoie son gestionnaire de requêtes
export async function chargerEdge(fichier) {
  let h = null;
  const env = { SB_URL: SB, SUPABASE_URL: SB, SB_SERVICE_ROLE: SERVICE, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SB_ANON: ANON, SUPABASE_ANON_KEY: ANON, LX_WORKER_URL: "https://luxyra.fr" };
  globalThis.Deno = { env: { get: (k) => env[k] }, serve: (fn) => { h = fn; } };
  await import(fichier + "?" + Math.random());
  return h;
}
export async function appelEdge(h, body, jwt) {
  const r = await h(new Request("https://edge.test/", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, jwt ? { Authorization: "Bearer " + jwt } : {}), body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json().catch(() => null) };
}
export async function appelWorker(monde, chemin, body, headers) {
  const r = await monde.worker.fetch(new Request("https://luxyra.fr" + chemin, { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, headers || {}), body: JSON.stringify(body) }), monde.env, { waitUntil() {} });
  return { status: r.status, body: await r.json().catch(() => null) };
}
