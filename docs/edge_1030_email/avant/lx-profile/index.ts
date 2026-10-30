// lx-profile v9 — 2026-10-14 : version FUSIONNÉE des lots « secu » et « site » (intégration integ1014).
//   site : nouveau mot de passe 8 caractères minimum (change_password).
// 2026-10-14 SECURITE (audit) :
//   - version de session : le jeton porte sv ; il est refusé si clients_luxyra.session_version a changé
//     (changement / réinitialisation du mot de passe => les AUTRES appareils sont déconnectés ;
//     l'appareil qui change son mot de passe reçoit un nouveau jeton) ;
//   - suppression du compte : mot de passe OBLIGATOIRE (vérifié ici) ;
//   - vérification de l'email : actions verify_email (lien reçu, sans session) et send_verification (renvoi, limité) ;
//   - check_password (utilisé par le worker avant l'anonymisation du compte) ;
//   - tentatives de mot de passe limitées (8 échecs / 15 min, table login_attempts).
// lx-profile v8 — v7 + « Autre pays » (2026-10-13)
// lx-profile v7 — pays (France / Allemagne / Luxembourg / Belgique / Suisse)
// lx-profile v5 — v4 + monitoring 100%
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verify as jwtVerify, create as jwtCreate, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";
const SB_URL = Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL")!;
const SB_SR  = Deno.env.get("SB_SERVICE_ROLE") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LX_SECRET = Deno.env.get("LX_SESSION_SECRET") || Deno.env.get("BP_SESSION_SECRET") || SB_SR;
const WORKER_BASE = Deno.env.get("WORKER_BASE") || "https://luxyra.fr";
const sb = createClient(SB_URL, SB_SR, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const SAFE_COLUMNS = "id,email,nom,prenom,telephone,date_naissance,genre,sms_ok,email_ok,email_verified,avatar_url,stripe_customer_id,stripe_pm,card_last4,card_exp,adresse,cp,ville,pays,created_at,updated_at,last_login";
const PAYS = ["France","Allemagne","Luxembourg","Belgique","Suisse","Autre pays"];
function json(s:number,b:unknown){return new Response(JSON.stringify(b),{status:s,headers:{...CORS,"Content-Type":"application/json"}});}
{ const _LX_FN="lx-profile"; const _LX_URL=Deno.env.get("SB_URL")||Deno.env.get("SUPABASE_URL")||""; const _LX_SR=Deno.env.get("SB_SERVICE_ROLE")||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||""; const _lxReport=async(msg:string,sev:"warning"|"error"|"critical",err?:unknown,ctx?:Record<string,unknown>)=>{try{await fetch(_LX_URL+"/rest/v1/rpc/report_server_error",{method:"POST",headers:{"Content-Type":"application/json","apikey":_LX_SR,"Authorization":"Bearer "+_LX_SR},body:JSON.stringify({p_source:"edge_fn:"+_LX_FN,p_message:String(msg||"").slice(0,800),p_severity:sev,p_stack:(err as Error)?.stack?String((err as Error).stack).slice(0,3000):null,p_context:ctx||null})});}catch(_){}}; (globalThis as any).__lxReport=_lxReport; const _orig=Deno.serve; (Deno as any).serve=(handler:any,opts?:any)=>_orig(async(req:Request)=>{try{const res=await handler(req); if(res&&res.status>=500){const body=await res.clone().text().catch(()=>""); await _lxReport("HTTP "+res.status,"error",undefined,{url:req.url,body:body.slice(0,500)});} return res;}catch(e){const err=e as Error; await _lxReport("Exception non gérée: "+(err?.message||String(e)),"critical",err,{url:req.url}); return new Response(JSON.stringify({error:"Internal server error"}),{status:500,headers:{"Content-Type":"application/json"}});}}, opts); }
function toHex(buf: ArrayBuffer | Uint8Array): string { const arr = buf instanceof Uint8Array ? buf : new Uint8Array(buf); return Array.from(arr).map((b)=>b.toString(16).padStart(2,"0")).join(""); }
function fromHex(hex: string): Uint8Array { const arr = new Uint8Array(hex.length/2); for (let i=0; i<arr.length; i++) arr[i] = parseInt(hex.substr(i*2,2),16); return arr; }
function timingSafeEqual(a: string, b: string): boolean { if (a.length !== b.length) return false; let r = 0; for (let i=0; i<a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
async function sha256Hex(s: string): Promise<string> { return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))); }
async function pbkdf2Hash(password: string, salt: Uint8Array, iterations: number): Promise<string> { const km = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]); const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, km, 256); return toHex(bits); }
async function hashPassword(password: string): Promise<string> { const salt = crypto.getRandomValues(new Uint8Array(16)); const it = 120_000; return `pbkdf2$${it}$${toHex(salt)}$${await pbkdf2Hash(password, salt, it)}`; }
async function verifyPassword(password: string, email: string, stored: string): Promise<boolean> {
  if (!stored) return false;
  if (stored.startsWith("pbkdf2$")) { const parts = stored.split("$"); if (parts.length !== 4) return false; const iter = parseInt(parts[1],10); const salt = fromHex(parts[2]); const computed = await pbkdf2Hash(password, salt, iter); return timingSafeEqual(computed, parts[3]); }
  const salted = await sha256Hex(email + ":" + password); const unsalted = await sha256Hex(password); return timingSafeEqual(stored, salted) || timingSafeEqual(stored, unsalted);
}
async function isPasswordPwned(password: string): Promise<boolean> { try { const sha1 = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(password)); const hashHex = toHex(sha1).toUpperCase(); const prefix = hashHex.slice(0,5); const suffix = hashHex.slice(5); const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, { headers: { "Add-Padding":"true","User-Agent":"Luxyra-LX" } }); if (!res.ok) return false; const text = await res.text(); for (const line of text.split("\n")) { const parts = line.trim().split(":"); if (parts[0] === suffix && parseInt(parts[1],10) > 0) return true; } return false; } catch { return false; } }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function hmacKey() { return await crypto.subtle.importKey("raw", new TextEncoder().encode(LX_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign","verify"]); }
async function signSession(lx_id: string, email: string, sv: number): Promise<string> { return await jwtCreate({ alg: "HS256", typ: "JWT" }, { lx_id, bp_id: lx_id, email, sv, iat: getNumericDate(0), exp: getNumericDate(60*60*24*30) }, await hmacKey()); }
// 2026-10-14 : le jeton n'est valable que si sa version (sv, 0 pour les anciens jetons) = session_version du compte.
async function verifySession(token: string): Promise<{ lx_id: string; email: string; email_verified: boolean; sv: number } | null> {
  try {
    const payload = await jwtVerify(token, await hmacKey());
    if (!payload) return null;
    const id = String((payload as any).lx_id || (payload as any).bp_id || "");
    if (!UUID_RE.test(id)) return null;
    const { data: row } = await sb.from("clients_luxyra").select("id, email, email_verified, session_version").eq("id", id).maybeSingle();
    if (!row) return null; // compte supprimé
    const sv = Number((payload as any).sv ?? 0) || 0;
    if (sv !== (Number(row.session_version) || 0)) return null; // mot de passe changé ailleurs
    return { lx_id: String(row.id), email: String(row.email || "").toLowerCase().trim(), email_verified: row.email_verified === true, sv };
  } catch { return null; }
}
function ipDe(req: Request): string { return (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0].trim().slice(0, 64); }
async function tropDEchecs(email: string): Promise<boolean> {
  try { const since = new Date(Date.now() - 15 * 60 * 1000).toISOString(); const { count } = await sb.from("login_attempts").select("id", { count: "exact", head: true }).eq("email", email).eq("ok", false).gte("at", since); return (count || 0) >= 8; } catch { return false; }
}
async function noter(email: string, ip: string, ok: boolean) { try { await sb.from("login_attempts").insert({ email, ip: ip || null, ok }); } catch {} }
// Contrôle du mot de passe actuel (limité) : null si OK, sinon la réponse d'erreur à renvoyer
async function controleMotDePasse(lx_id: string, pass: string, ip: string, msg: string): Promise<Response | null> {
  const { data: row } = await sb.from("clients_luxyra").select("id,email,password_hash").eq("id", lx_id).single();
  if (!row) return json(404, { error: "Utilisateur introuvable" });
  const em = String(row.email || "").toLowerCase();
  if (await tropDEchecs(em)) return json(429, { error: "Trop de tentatives. Réessayez dans 15 minutes." });
  if (!pass) return json(400, { error: "Mot de passe requis" });
  const ok = await verifyPassword(pass, row.email, row.password_hash || "");
  if (!ok) { await noter(em, ip, false); return json(401, { error: msg }); }
  return null;
}
async function nouvelleVersion(lx_id: string): Promise<number> {
  const { data, error } = await sb.rpc("lx_client_session_bump", { p_id: lx_id });
  if (error) throw new Error("session_version: " + error.message);
  return Number(data) || 0;
}
function esc(s:unknown){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
function lxMailLayout(corpsHtml: string, titre: string): string {
  return `<div style="background:#f4f1ea;padding:24px 10px;margin:0">
  <div style="max-width:580px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e6dcc3;font-family:-apple-system,'Segoe UI',Arial,sans-serif;color:#1a1a1a;font-size:15px;line-height:1.6">
    <div style="background:#0b0b0b;padding:26px 20px 20px;text-align:center;border-bottom:3px solid #c8a84e">
      <img src="https://luxyra.fr/email/luxyra-logo-128.png" width="64" height="64" alt="Luxyra" style="display:block;margin:0 auto 10px;border-radius:12px">
      <div style="color:#d4a843;font-family:Georgia,'Times New Roman',serif;font-size:22px;letter-spacing:6px">LUXYRA</div>
      <div style="color:#8c8270;font-size:11px;letter-spacing:1px;margin-top:4px;text-transform:uppercase">VOTRE ESPACE BEAUTÉ &amp; BIEN-ÊTRE</div>
    </div>
    <div style="padding:28px 26px 8px"><h1 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:400;color:#1a1a1a;line-height:1.3">${titre}</h1>${corpsHtml}</div>
    <div style="padding:16px 26px 22px;font-size:11px;color:#8a8a8a;border-top:1px solid #eee;margin-top:18px;line-height:1.5">Luxyra — Alexandre JENSEN, entrepreneur individuel — SIRET 910 928 464 00023<br>29 rue de l'Abbé Alexandre Pax, 57200 Sarreguemines — <a href="mailto:contact@luxyra.fr" style="color:#b8922e">contact@luxyra.fr</a> — <a href="https://luxyra.fr" style="color:#b8922e">luxyra.fr</a></div>
  </div></div>`;
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  try {
    const body = await req.json().catch(() => null);
    if (!body) return json(400, { error: "Requête invalide" });
    const ip = ipDe(req);
    // ---- 2026-10-14 : confirmation de l'email par le lien reçu (aucune session nécessaire : le jeton suffit)
    if (body.action === "verify_email") {
      const token = String(body.token || "").trim();
      if (!/^[0-9a-f]{64}$/.test(token)) return json(400, { error: "Lien invalide ou expiré. Demandez un nouveau lien depuis votre compte." });
      const h = await sha256Hex(token);
      const { data: row } = await sb.from("clients_luxyra").select("id, email, verification_expires_at, email_verified").eq("verification_code", h).maybeSingle();
      if (!row || !row.verification_expires_at || new Date(row.verification_expires_at).getTime() < Date.now()) return json(400, { error: "Lien invalide ou expiré. Demandez un nouveau lien depuis votre compte." });
      const { data: maj, error } = await sb.from("clients_luxyra").update({ email_verified: true, verification_code: null, verification_expires_at: null, updated_at: new Date().toISOString() }).eq("id", row.id).eq("verification_code", h).select("id");
      if (error || !maj || !maj.length) return json(400, { error: "Lien déjà utilisé." });
      return json(200, { ok: true, email: row.email });
    }
    if (!body.session_token) return json(401, { error: "session_token requis" });
    const session = await verifySession(String(body.session_token));
    if (!session) return json(401, { error: "Session invalide ou expirée" });
    const lx_id = session.lx_id;
    const action = String(body.action || "get");
    if (action === "get") { const { data: user, error } = await sb.from("clients_luxyra").select(SAFE_COLUMNS).eq("id", lx_id).single(); if (error || !user) return json(404, { error: "Utilisateur introuvable" }); return json(200, { user }); }
    if (action === "send_verification") {
      const { data: u } = await sb.from("clients_luxyra").select("id, email, prenom, email_verified, verification_sent_at, verification_envois, verification_jour").eq("id", lx_id).single();
      if (!u) return json(404, { error: "Utilisateur introuvable" });
      if (u.email_verified) return json(200, { ok: true, deja: true });
      const now = new Date();
      if (u.verification_sent_at && now.getTime() - new Date(u.verification_sent_at).getTime() < 120 * 1000) return json(429, { error: "Un email vient d'être envoyé. Patientez 2 minutes avant d'en demander un autre." });
      const jour = now.toISOString().slice(0, 10);
      const nb = (u.verification_jour === jour ? Number(u.verification_envois) || 0 : 0);
      if (nb >= 5) return json(429, { error: "Trop d'envois aujourd'hui. Réessayez demain ou écrivez à contact@luxyra.fr." });
      const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
      const { error: upErr } = await sb.from("clients_luxyra").update({ verification_code: await sha256Hex(token), verification_expires_at: new Date(now.getTime() + 48 * 3600 * 1000).toISOString(), verification_sent_at: now.toISOString(), verification_envois: nb + 1, verification_jour: jour }).eq("id", lx_id);
      if (upErr) return json(500, { error: "Erreur interne" });
      const lien = `https://luxyra.fr/compte.html?verif=${token}`;
      const html = lxMailLayout(`<p style="font-size:15px">Bonjour ${esc(u.prenom || "")},</p><p style="font-size:15px;line-height:1.6">Confirmez votre adresse email pour retrouver dans votre compte Luxyra vos rendez-vous, tickets, points de fidélité et cartes enregistrés par vos établissements.</p><p style="text-align:center;margin:22px 0"><a href="${esc(lien)}" style="display:inline-block;background:#c8a84e;color:#111;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:30px">Confirmer mon adresse email</a></p><p style="font-size:12px;color:#8a8a8a">Ce lien est valable 48 heures. Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>`, "Confirmez votre adresse email");
      const r = await fetch(`${WORKER_BASE}/api/email/custom`, { method: "POST", headers: { "Content-Type": "application/json", "x-lx-internal": SB_SR }, body: JSON.stringify({ to: u.email, toName: u.prenom || "", salonName: "Luxyra", subject: "Confirmez votre adresse email Luxyra", htmlContent: html, textContent: `Bonjour,\n\nConfirmez votre adresse email Luxyra (lien valable 48 heures) :\n${lien}\n\nLuxyra` }) }).catch(() => null);
      if (!r || !r.ok) { await (globalThis as any).__lxReport?.("Renvoi email de vérification HTTP " + (r ? r.status : "réseau"), "warning"); return json(502, { error: "L'email n'a pas pu être envoyé. Réessayez dans quelques minutes." }); }
      return json(200, { ok: true });
    }
    if (action === "check_password") {
      const refus = await controleMotDePasse(lx_id, String(body.password || ""), ip, "Mot de passe incorrect");
      if (refus) return refus;
      return json(200, { ok: true, lx_id, email: session.email, email_verified: session.email_verified });
    }
    if (action === "update") { const allowed = ["nom","prenom","telephone","date_naissance","genre","sms_ok","email_ok","adresse","cp","ville","pays","avatar_url"]; const patch: Record<string, unknown> = {}; for (const k of allowed) if (k in body) patch[k] = body[k]; if ("pays" in patch && !PAYS.includes(String(patch.pays))) delete patch.pays; if (Object.keys(patch).length === 0) return json(400, { error: "Aucun champ à mettre à jour" }); patch.updated_at = new Date().toISOString(); const { data: user, error } = await sb.from("clients_luxyra").update(patch).eq("id", lx_id).select(SAFE_COLUMNS).single(); if (error) return json(500, { error: error.message }); return json(200, { user }); }
    if (action === "change_password") {
      const oldPass = String(body.old_password || ""); const newPass = String(body.new_password || "");
      if (newPass.length < 8) return json(400, { error: "Nouveau mot de passe trop court (8 caractères minimum)" }); // 2026-10-14 audit site
      const refus = await controleMotDePasse(lx_id, oldPass, ip, "Ancien mot de passe incorrect");
      if (refus) return refus;
      if (await isPasswordPwned(newPass)) return json(400, { error: "Ce mot de passe a été exposé dans une fuite de données connue. Choisissez-en un autre plus unique." });
      const newHash = await hashPassword(newPass);
      const { error } = await sb.from("clients_luxyra").update({ password_hash: newHash, updated_at: new Date().toISOString() }).eq("id", lx_id);
      if (error) return json(500, { error: error.message });
      // 2026-10-14 : les autres appareils sont déconnectés ; celui-ci reçoit un nouveau jeton
      const sv = await nouvelleVersion(lx_id);
      return json(200, { success: true, session_token: await signSession(lx_id, session.email, sv) });
    }
    if (action === "logout_all") {
      const sv = await nouvelleVersion(lx_id);
      return json(200, { success: true, session_token: await signSession(lx_id, session.email, sv) });
    }
    if (action === "delete") {
      // 2026-10-14 SECURITE : mot de passe obligatoire (avant : facultatif — un jeton volé suffisait)
      const refus = await controleMotDePasse(lx_id, String(body.password || ""), ip, "Mot de passe incorrect");
      if (refus) return refus;
      const { error } = await sb.from("clients_luxyra").delete().eq("id", lx_id);
      if (error) return json(500, { error: error.message });
      return json(200, { success: true });
    }
    if (action === "remove_payment") { const { error } = await sb.from("clients_luxyra").update({ stripe_pm: null, card_last4: null, card_exp: null, updated_at: new Date().toISOString() }).eq("id", lx_id); if (error) return json(500, { error: error.message }); return json(200, { success: true }); }
    if (action === "toggle_notif") { const field = String(body.field || ""); if (field !== "sms_ok" && field !== "email_ok") return json(400, { error: "field doit être 'sms_ok' ou 'email_ok'" }); const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }; patch[field] = Boolean(body.value); const { error } = await sb.from("clients_luxyra").update(patch).eq("id", lx_id); if (error) return json(500, { error: error.message }); return json(200, { success: true }); }
    return json(400, { error: "Action inconnue: " + action });
  } catch (e) {
    console.error("lx-profile unexpected", e);
    return json(500, { error: String((e as Error)?.message || e) });
  }
});
