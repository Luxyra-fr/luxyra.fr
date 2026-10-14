// lx-profile v9 — 2026-10-14 audit : nouveau mot de passe 8 caractères minimum (change_password).
// ⚠ Le lot « secu » modifie aussi lx-profile (session_version, mot de passe à la suppression) : fusionner
//   les deux versions (seul changement de ce lot : la ligne « newPass.length < 8 » de change_password).
// lx-profile v8 — v7 + « Autre pays » (2026-10-13)
// lx-profile v7 — pays (France / Allemagne / Luxembourg / Belgique / Suisse)
// lx-profile v5 — v4 + monitoring 100%
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verify as jwtVerify } from "https://deno.land/x/djwt@v3.0.2/mod.ts";
const SB_URL = Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL")!;
const SB_SR  = Deno.env.get("SB_SERVICE_ROLE") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LX_SECRET = Deno.env.get("LX_SESSION_SECRET") || Deno.env.get("BP_SESSION_SECRET") || SB_SR;
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
async function verifySession(token: string): Promise<{ lx_id: string; email: string } | null> { try { const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(LX_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign","verify"]); const payload = await jwtVerify(token, key); if (!payload) return null; const id = (payload as any).lx_id || (payload as any).bp_id; if (!id) return null; return { lx_id: String(id), email: String((payload as any).email || "") }; } catch { return null; } }
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  try {
    const body = await req.json().catch(() => null);
    if (!body || !body.session_token) return json(401, { error: "session_token requis" });
    const session = await verifySession(String(body.session_token));
    if (!session) return json(401, { error: "Session invalide ou expirée" });
    const lx_id = session.lx_id;
    const action = String(body.action || "get");
    if (action === "get") { const { data: user, error } = await sb.from("clients_luxyra").select(SAFE_COLUMNS).eq("id", lx_id).single(); if (error || !user) return json(404, { error: "Utilisateur introuvable" }); return json(200, { user }); }
    if (action === "update") { const allowed = ["nom","prenom","telephone","date_naissance","genre","sms_ok","email_ok","adresse","cp","ville","pays","avatar_url"]; const patch: Record<string, unknown> = {}; for (const k of allowed) if (k in body) patch[k] = body[k]; if ("pays" in patch && !PAYS.includes(String(patch.pays))) delete patch.pays; if (Object.keys(patch).length === 0) return json(400, { error: "Aucun champ à mettre à jour" }); patch.updated_at = new Date().toISOString(); const { data: user, error } = await sb.from("clients_luxyra").update(patch).eq("id", lx_id).select(SAFE_COLUMNS).single(); if (error) return json(500, { error: error.message }); return json(200, { user }); }
    if (action === "change_password") { const oldPass = String(body.old_password || ""); const newPass = String(body.new_password || ""); if (newPass.length < 8) return json(400, { error: "Nouveau mot de passe trop court (8 caractères minimum)" }); /* 2026-10-14 audit */ const { data: row } = await sb.from("clients_luxyra").select("id,email,password_hash").eq("id", lx_id).single(); if (!row) return json(404, { error: "Utilisateur introuvable" }); const ok = await verifyPassword(oldPass, row.email, row.password_hash || ""); if (!ok) return json(401, { error: "Ancien mot de passe incorrect" }); if (await isPasswordPwned(newPass)) return json(400, { error: "Ce mot de passe a été exposé dans une fuite de données connue. Choisissez-en un autre plus unique." }); const newHash = await hashPassword(newPass); const { error } = await sb.from("clients_luxyra").update({ password_hash: newHash, updated_at: new Date().toISOString() }).eq("id", lx_id); if (error) return json(500, { error: error.message }); return json(200, { success: true }); }
    if (action === "delete") { const pass = body.password ? String(body.password) : ""; if (pass) { const { data: row } = await sb.from("clients_luxyra").select("id,email,password_hash").eq("id", lx_id).single(); if (!row) return json(404, { error: "Utilisateur introuvable" }); const ok = await verifyPassword(pass, row.email, row.password_hash || ""); if (!ok) return json(401, { error: "Mot de passe incorrect" }); } const { error } = await sb.from("clients_luxyra").delete().eq("id", lx_id); if (error) return json(500, { error: error.message }); return json(200, { success: true }); }
    if (action === "remove_payment") { const { error } = await sb.from("clients_luxyra").update({ stripe_pm: null, card_last4: null, card_exp: null, updated_at: new Date().toISOString() }).eq("id", lx_id); if (error) return json(500, { error: error.message }); return json(200, { success: true }); }
    if (action === "toggle_notif") { const field = String(body.field || ""); if (field !== "sms_ok" && field !== "email_ok") return json(400, { error: "field doit être 'sms_ok' ou 'email_ok'" }); const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }; patch[field] = Boolean(body.value); const { error } = await sb.from("clients_luxyra").update(patch).eq("id", lx_id); if (error) return json(500, { error: error.message }); return json(200, { success: true }); }
    return json(400, { error: "Action inconnue: " + action });
  } catch (e) {
    console.error("lx-profile unexpected", e);
    return json(500, { error: String((e as Error)?.message || e) });
  }
});
