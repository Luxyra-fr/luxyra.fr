// lx-password-reset v9 — 2026-10-31 (contre-audit 3) : adresse ASCII stricte (m4) ; abonnements push supprimés à la réinitialisation (m2).
// lx-password-reset v8 — 2026-10-30 (contre-audit 2) : e-mail sans prénom ; verification_email effacé à la confirmation.
// lx-password-reset v7 — 2026-10-30 SECURITE (contre-audit B1) : le jeton garde l'adresse d'envoi ; la confirmation ne
//   vérifie l'adresse que si elle est inchangée (sinon : mot de passe changé, adresse non vérifiée).
// lx-password-reset v5 — 2026-10-14 SECURITE : après réinitialisation, la version de session du compte est
//   incrémentée (lx_client_session_bump) : tous les appareils encore connectés sont déconnectés.
// lx-password-reset v1 — 2026-10-08 : « mot de passe oublie » pour les comptes clientes Luxyra.
// action request {email, retour?} : si le compte existe, envoie un lien valable 1 h (reponse identique dans tous les cas).
// action confirm {token, password} : change le mot de passe (lien a usage unique) et confirme l'email.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// 2026-10-10 : mise en page commune des emails Luxyra (identique au worker docs/luxyra-router-worker.js → lxMailLayout)
// opts.salon : si renseigné, email envoyé AU NOM d'un établissement à sa cliente (pied de page : « envoyé pour le compte de … via Luxyra »)
function lxMailLayout(corpsHtml: string, opts: { titre?: string; pied?: string; salon?: string; idSuivi?: string } = {}): string {
  const titre = opts.titre ? `<h1 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:400;color:#1a1a1a;line-height:1.3">${opts.titre}</h1>` : "";
  const pixel = opts.idSuivi ? `<img src="https://luxyra.fr/api/e/o/${opts.idSuivi}.gif" width="1" height="1" alt="" style="display:block;border:0">` : "";
  const pied = opts.pied ? `<div style="margin-bottom:6px">${opts.pied}</div>` : "";
  const sousTitre = opts.salon ? opts.salon : "VOTRE ESPACE BEAUTÉ &amp; BIEN-ÊTRE";
  const mentions = opts.salon
    ? `Email envoyé pour le compte de ${opts.salon} via <a href="https://luxyra.fr" style="color:#b8922e">Luxyra</a>.`
    : `Luxyra — Alexandre JENSEN, entrepreneur individuel — SIRET 910 928 464 00023<br>29 rue de l'Abbé Alexandre Pax, 57200 Sarreguemines — <a href="mailto:contact@luxyra.fr" style="color:#b8922e">contact@luxyra.fr</a> — <a href="https://luxyra.fr" style="color:#b8922e">luxyra.fr</a>`;
  return `<div style="background:#f4f1ea;padding:24px 10px;margin:0">
  <div style="max-width:580px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e6dcc3;font-family:-apple-system,'Segoe UI',Arial,sans-serif;color:#1a1a1a;font-size:15px;line-height:1.6">
    <div style="background:#0b0b0b;padding:26px 20px 20px;text-align:center;border-bottom:3px solid #c8a84e">
      <img src="https://luxyra.fr/email/luxyra-logo-128.png" width="64" height="64" alt="Luxyra" style="display:block;margin:0 auto 10px;border-radius:12px">
      <div style="color:#d4a843;font-family:Georgia,'Times New Roman',serif;font-size:22px;letter-spacing:6px">LUXYRA</div>
      <div style="color:#8c8270;font-size:11px;letter-spacing:1px;margin-top:4px;text-transform:uppercase">${sousTitre}</div>
    </div>
    <div style="padding:28px 26px 8px">${titre}${corpsHtml}</div>
    <div style="padding:16px 26px 22px;font-size:11px;color:#8a8a8a;border-top:1px solid #eee;margin-top:18px;line-height:1.5">${pied}${mentions}</div>
  </div>${pixel}</div>`;
}
function lxMailBouton(texte: string, url: string): string {
  return `<p style="text-align:center;margin:22px 0"><a href="${url}" style="display:inline-block;background:#c8a84e;color:#111;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:30px">${texte}</a></p>`;
}
const SB_URL = Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL")!;
const SB_SR  = Deno.env.get("SB_SERVICE_ROLE") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WORKER_BASE = Deno.env.get("WORKER_BASE") || "https://luxyra.fr";
const sb = createClient(SB_URL, SB_SR, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s:number,b:unknown){return new Response(JSON.stringify(b),{status:s,headers:{...CORS,"Content-Type":"application/json"}});}
function esc(s:unknown){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
async function report(msg:string, ctx?:unknown){ try{ await sb.rpc("report_server_error",{ p_source:"edge_fn:lx-password-reset", p_message:msg.slice(0,800), p_severity:"error", p_stack:null, p_context: ctx||null }); }catch(_){} }
function toHex(buf: ArrayBuffer | Uint8Array): string { const arr = buf instanceof Uint8Array ? buf : new Uint8Array(buf); return Array.from(arr).map((b)=>b.toString(16).padStart(2,"0")).join(""); }
async function sha256Hex(s: string): Promise<string> { return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))); }
async function pbkdf2Hash(password: string, salt: Uint8Array, iterations: number): Promise<string> { const km = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]); const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, km, 256); return toHex(bits); }
async function hashPassword(password: string): Promise<string> { const salt = crypto.getRandomValues(new Uint8Array(16)); const it = 120_000; return `pbkdf2$${it}$${toHex(salt)}$${await pbkdf2Hash(password, salt, it)}`; }
function retourSur(u: unknown): string { try { const x = new URL(String(u||"")); if (x.protocol === "https:" && (x.hostname === "luxyra.fr" || x.hostname.endsWith(".luxyra.fr"))) return x.toString(); } catch {} return ""; }
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  try {
    const body = await req.json().catch(() => null);
    if (!body) return json(400, { error: "Requête invalide" });
    const action = String(body.action || "");
    if (action === "request") {
      const email = String(body.email || "").toLowerCase().trim().slice(0, 200);
      const neutre = { ok: true, message: "Si un compte existe avec cet email, un lien de réinitialisation vient d'être envoyé." };
      if (!/^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,24}$/.test(email) || /\.\.|^\.|\.@|@-|-\./.test(email)) return json(400, { error: "Email invalide" }); // 31/10 (contre-audit 3, m4)
      const { data: u } = await sb.from("clients_luxyra").select("id, email, prenom").eq("email", email).maybeSingle();
      if (!u) return json(200, neutre);
      const depuis = new Date(Date.now() - 3600 * 1000).toISOString();
      const { count } = await sb.from("client_password_resets").select("id", { count: "exact", head: true }).eq("client_id", u.id).gte("created_at", depuis);
      if ((count || 0) >= 3) return json(200, neutre);
      const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
      const { error: insErr } = await sb.from("client_password_resets").insert({ client_id: u.id, email: String(u.email || "").toLowerCase(), token_hash: await sha256Hex(token), expires_at: new Date(Date.now() + 3600 * 1000).toISOString() });
      if (insErr) { await report("insert reset: " + insErr.message); return json(500, { error: "Erreur interne" }); }
      const retour = retourSur(body.retour);
      const lien = `https://luxyra.fr/compte.html?reset=${token}` + (retour ? `&retour=${encodeURIComponent(retour)}` : "");
      const html = lxMailLayout(`<p style="font-size:15px">Bonjour,</p><p style="font-size:15px;line-height:1.6">Vous avez demandé à réinitialiser le mot de passe de votre compte Luxyra.</p>${lxMailBouton("Choisir un nouveau mot de passe", esc(lien))}<p style="font-size:12px;color:#8a8a8a">Ce lien est valable 1 heure et ne peut servir qu'une fois. Si vous n'êtes pas à l'origine de cette demande, ignorez cet email : votre mot de passe actuel reste valable.</p>`, { titre: "Réinitialisation de votre mot de passe" });
      const r = await fetch(`${WORKER_BASE}/api/email/custom`, { method: "POST", headers: { "Content-Type": "application/json", "x-lx-internal": SB_SR }, body: JSON.stringify({ to: u.email, toName: "", salonName: "Luxyra", subject: "Réinitialisation de votre mot de passe Luxyra", htmlContent: html, textContent: `Bonjour,\n\nPour choisir un nouveau mot de passe (lien valable 1 heure) :\n${lien}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez cet email.\n\nLuxyra` }) });
      if (!r.ok) { await report("envoi email reset HTTP " + r.status + ": " + (await r.text()).slice(0, 200)); }
      return json(200, neutre);
    }
    if (action === "confirm") {
      const token = String(body.token || "").trim();
      const password = String(body.password || "");
      if (!/^[0-9a-f]{64}$/.test(token)) return json(400, { error: "Lien invalide ou expiré. Refaites une demande." });
      if (password.length < 8) return json(400, { error: "Mot de passe : 8 caractères minimum" });
      const { data: rs } = await sb.from("client_password_resets").select("id, client_id, email, expires_at, used_at").eq("token_hash", await sha256Hex(token)).maybeSingle();
      if (!rs || rs.used_at || new Date(rs.expires_at).getTime() < Date.now()) return json(400, { error: "Lien invalide ou expiré. Refaites une demande." });
      const { data: marque } = await sb.from("client_password_resets").update({ used_at: new Date().toISOString() }).eq("id", rs.id).is("used_at", null).select("id");
      if (!marque || !marque.length) return json(400, { error: "Lien déjà utilisé. Refaites une demande." });
      // Le lien a été reçu dans la boîte mail : l'adresse est vérifiée — SEULEMENT si c'est toujours l'adresse à laquelle le lien
      // a été envoyé (30/10/2026, contre-audit B1 : sinon un lien demandé avant un changement d'adresse confirmerait l'adresse d'un tiers).
      const { data: cur } = await sb.from("clients_luxyra").select("email").eq("id", rs.client_id).maybeSingle();
      const memeAdresse = !!(rs.email && cur && String(cur.email || "").toLowerCase() === String(rs.email).toLowerCase());
      const patchMdp: Record<string, unknown> = { password_hash: await hashPassword(password), updated_at: new Date().toISOString() };
      if (memeAdresse) { patchMdp.email_verified = true; patchMdp.verification_code = null; patchMdp.verification_email = null; patchMdp.verification_expires_at = null; }
      let q = sb.from("clients_luxyra").update(patchMdp).eq("id", rs.client_id);
      if (memeAdresse) q = q.eq("email", cur!.email); // course avec un changement d'adresse : rien n'est écrit
      const { data: u, error: upErr } = await q.select("email").single();
      if (upErr || !u) { await report("update mot de passe: " + (upErr?.message || "?")); return json(500, { error: "Erreur interne" }); }
      // 2026-10-14 : déconnexion de tous les appareils (les anciens jetons portent l'ancienne version)
      const { error: bumpErr } = await sb.rpc("lx_client_session_bump", { p_id: rs.client_id });
      if (bumpErr) await report("session_version après réinitialisation: " + bumpErr.message);
      // 31/10/2026 (contre-audit 3, m2) : les notifications push des appareils précédents sont supprimées
      try { await sb.from("client_push_subscriptions").delete().eq("client_luxyra_id", rs.client_id); } catch {}
      try { await sb.from("login_attempts").delete().eq("email", String(u.email).toLowerCase()).eq("ok", false); } catch {}
      return json(200, { ok: true, email: u.email });
    }
    return json(400, { error: "action invalide" });
  } catch (e) {
    await report("exception: " + String((e as Error)?.message || e));
    return json(500, { error: "Erreur interne" });
  }
});
