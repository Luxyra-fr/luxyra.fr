// lx-signup v13 — 2026-10-31 (contre-audit 3) : adresse ASCII stricte (m4) ; e-mail : « si vous n'avez pas créé de compte, ne cliquez pas » (M1).
// lx-signup v12 — 2026-10-30 (contre-audit 2) : lien de confirmation lié à l'adresse (verification_email), écriture conditionnelle, e-mail sans prénom.
// lx-signup v10 — 2026-10-14 : version FUSIONNÉE des lots « secu » et « site » (intégration integ1014).
//   site : mot de passe 8 caractères minimum (comme partout ailleurs).
// 2026-10-14 SECURITE : vérification de l'adresse email (lien envoyé à l'inscription, valable 48 h)
//   + version de session (sv) dans le jeton (déconnexion des autres appareils après changement de mot de passe).
//   Tant que l'email n'est pas vérifié, le worker ne rattache AUCUNE donnée par email (seulement par client_luxyra_id).
// lx-signup v9 — v8 + « Autre pays » (2026-10-13)
// lx-signup v8 — pays (France / Allemagne / Luxembourg / Belgique / Suisse)
// lx-signup v7 — adresse / code postal / ville enregistrés dès la création (utile pour les RDV à domicile)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { create as jwtCreate, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";
const SB_URL = Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL")!;
const SB_SR  = Deno.env.get("SB_SERVICE_ROLE") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LX_SECRET = Deno.env.get("LX_SESSION_SECRET") || Deno.env.get("BP_SESSION_SECRET") || SB_SR;
const WORKER_BASE = Deno.env.get("WORKER_BASE") || "https://luxyra.fr";
const sb = createClient(SB_URL, SB_SR, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const PAYS = ["France","Allemagne","Luxembourg","Belgique","Suisse","Autre pays"];
function json(s:number,b:unknown){return new Response(JSON.stringify(b),{status:s,headers:{...CORS,"Content-Type":"application/json"}});}
{ const _LX_FN="lx-signup"; const _LX_URL=Deno.env.get("SB_URL")||Deno.env.get("SUPABASE_URL")||""; const _LX_SR=Deno.env.get("SB_SERVICE_ROLE")||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||""; const _lxReport=async(msg:string,sev:"warning"|"error"|"critical",err?:unknown,ctx?:Record<string,unknown>)=>{try{await fetch(_LX_URL+"/rest/v1/rpc/report_server_error",{method:"POST",headers:{"Content-Type":"application/json","apikey":_LX_SR,"Authorization":"Bearer "+_LX_SR},body:JSON.stringify({p_source:"edge_fn:"+_LX_FN,p_message:String(msg||"").slice(0,800),p_severity:sev,p_stack:(err as Error)?.stack?String((err as Error).stack).slice(0,3000):null,p_context:ctx||null})});}catch(_){}}; (globalThis as any).__lxReport=_lxReport; const _orig=Deno.serve; (Deno as any).serve=(handler:any,opts?:any)=>_orig(async(req:Request)=>{try{const res=await handler(req); if(res&&res.status>=500){const body=await res.clone().text().catch(()=>""); await _lxReport("HTTP "+res.status,"error",undefined,{url:req.url,body:body.slice(0,500)});} return res;}catch(e){const err=e as Error; await _lxReport("Exception non gérée: "+(err?.message||String(e)),"critical",err,{url:req.url}); return new Response(JSON.stringify({error:"Internal server error"}),{status:500,headers:{"Content-Type":"application/json"}});}}, opts); }
function toHex(buf: ArrayBuffer | Uint8Array): string { const arr = buf instanceof Uint8Array ? buf : new Uint8Array(buf); return Array.from(arr).map((b)=>b.toString(16).padStart(2,"0")).join(""); }
async function sha256Hex(s: string): Promise<string> { return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))); }
async function pbkdf2Hash(password: string, salt: Uint8Array, iterations: number): Promise<string> { const km = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]); const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, km, 256); return toHex(bits); }
async function hashPassword(password: string): Promise<string> { const salt = crypto.getRandomValues(new Uint8Array(16)); const it = 120_000; return `pbkdf2$${it}$${toHex(salt)}$${await pbkdf2Hash(password, salt, it)}`; }
// 2026-10-14 : sv = version de session (clients_luxyra.session_version) — vérifiée à chaque appel par lx-profile
async function signSession(lx_id: string, email: string, sv: number): Promise<string> { const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(LX_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]); return await jwtCreate({ alg: "HS256", typ: "JWT" }, { lx_id, bp_id: lx_id, email, sv, iat: getNumericDate(0), exp: getNumericDate(60*60*24*30) }, key); }
async function isPasswordPwned(password: string): Promise<boolean> { try { const sha1 = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(password)); const hashHex = toHex(sha1).toUpperCase(); const prefix = hashHex.slice(0,5); const suffix = hashHex.slice(5); const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, { headers: { "Add-Padding":"true","User-Agent":"Luxyra-LX" } }); if (!res.ok) return false; const text = await res.text(); for (const line of text.split("\n")) { const parts = line.trim().split(":"); if (parts[0] === suffix && parseInt(parts[1],10) > 0) return true; } return false; } catch { return false; } }
const _txt = (v: unknown, max: number) => { const s = String(v == null ? "" : v).trim().slice(0, max); return s || null; };
function esc(s:unknown){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
// Mise en page commune des emails Luxyra (identique à lx-password-reset / worker lxMailLayout)
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
// 2026-10-14 : lien de vérification (jeton aléatoire, seule son empreinte SHA-256 est stockée)
async function envoyerVerification(userId: string, email: string, prenom: string): Promise<boolean> {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const now = new Date();
  // 30/10/2026 (contre-audit 2) : lien lié à l'adresse, écriture conditionnelle (même adresse, non confirmée) ; 0 ligne = aucun envoi
  const { data: res, error } = await sb.from("clients_luxyra").update({ verification_code: await sha256Hex(token), verification_email: String(email).toLowerCase(), verification_expires_at: new Date(now.getTime() + 48 * 3600 * 1000).toISOString(), verification_sent_at: now.toISOString(), verification_envois: 1, verification_jour: now.toISOString().slice(0, 10) }).eq("id", userId).eq("email", email).eq("email_verified", false).select("id");
  if (error) { await (globalThis as any).__lxReport?.("Jeton de vérification non enregistré: " + error.message, "error"); return false; }
  if (!res || !res.length) return false;
  const lien = `https://luxyra.fr/compte.html?verif=${token}`;
  const html = lxMailLayout(`<p style="font-size:15px">Bonjour,</p><p style="font-size:15px;line-height:1.6">Bienvenue sur Luxyra ! Confirmez votre adresse email pour retrouver dans votre compte vos rendez-vous, tickets, points de fidélité et cartes enregistrés par vos établissements.</p><p style="text-align:center;margin:22px 0"><a href="${esc(lien)}" style="display:inline-block;background:#c8a84e;color:#111;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:30px">Confirmer mon adresse email</a></p><p style="font-size:12px;color:#8a8a8a">Ce lien est valable 48 heures.</p><p style="font-size:14px;line-height:1.6;color:#b3261e"><b>Si vous n'avez pas créé de compte Luxyra, ne cliquez pas</b> : quelqu'un a pu saisir votre adresse par erreur. Rien ne sera relié à votre adresse sans confirmation avec le mot de passe du compte.</p>`, "Confirmez votre adresse email");
  try {
    const r = await fetch(`${WORKER_BASE}/api/email/custom`, { method: "POST", headers: { "Content-Type": "application/json", "x-lx-internal": SB_SR }, body: JSON.stringify({ to: email, toName: "", salonName: "Luxyra", subject: "Confirmez votre adresse email Luxyra", htmlContent: html, textContent: `Bonjour,\n\nConfirmez votre adresse email Luxyra (lien valable 48 heures) :\n${lien}\n\nSi vous n'avez pas créé de compte, ignorez cet email.\n\nLuxyra` }) });
    if (!r.ok) { await (globalThis as any).__lxReport?.("Email de vérification HTTP " + r.status, "warning"); return false; }
    return true;
  } catch (e) { await (globalThis as any).__lxReport?.("Email de vérification: " + String((e as Error)?.message || e), "warning"); return false; }
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  try {
    const body = await req.json().catch(() => null);
    if (!body) return json(400, { error: "Invalid JSON body" });
    const email = String(body.email || "").toLowerCase().trim();
    const password = String(body.password || "");
    const nom = String(body.nom || "").trim();
    const prenom = String(body.prenom || "").trim();
    const telephone = body.telephone ? String(body.telephone).trim() : null;
    if (!email || email.length > 200 || !/^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,24}$/.test(email) || /\.\.|^\.|\.@|@-|-\./.test(email)) return json(400, { error: "Email invalide" }); // 31/10 (contre-audit 3, m4) : ASCII strict, comme change_email
    if (password.length < 8) return json(400, { error: "Mot de passe trop court (8 caractères minimum)" }); // 2026-10-14 audit site
    if (!nom || !prenom) return json(400, { error: "Nom et prénom requis" });
    if (await isPasswordPwned(password)) return json(400, { error: "Ce mot de passe a été exposé dans une fuite de données connue. Choisissez-en un autre plus unique." });
    const { data: existing } = await sb.from("clients_luxyra").select("id").eq("email", email).limit(1);
    if (existing && existing.length > 0) return json(409, { error: "Un compte existe déjà avec cet email. Connectez-vous." });
    const password_hash = await hashPassword(password);
    const pays = PAYS.includes(String(body.pays || "")) ? String(body.pays) : "France";
    const { data: user, error } = await sb.from("clients_luxyra").insert({ email, password_hash, nom: nom.slice(0, 80), prenom: prenom.slice(0, 80), telephone, date_naissance: body.date_naissance || null, genre: body.genre || null, sms_ok: body.sms_ok ?? true, email_ok: body.email_ok ?? true, email_verified: false, adresse: _txt(body.adresse, 200), cp: _txt(body.cp, 10), ville: _txt(body.ville, 80), pays }).select().single();
    if (error) { console.error("lx-signup insert error", error); await (globalThis as any).__lxReport?.("Insert clients_luxyra échec: "+error.message, "error", undefined, { email }); return json(500, { error: error.message }); }
    const envoye = await envoyerVerification(user.id, user.email, user.prenom || "");
    const session_token = await signSession(user.id, user.email, Number(user.session_version) || 0);
    const { password_hash: _ph, verification_code: _vc, verification_email: _ve, ...safe } = user;
    return json(200, { user: { ...safe, email_verified: false }, session_token, verification_envoyee: envoye });
  } catch (e) {
    console.error("lx-signup unexpected", e);
    return json(500, { error: String((e as Error)?.message || e) });
  }
});
