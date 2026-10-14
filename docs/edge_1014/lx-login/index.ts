// lx-login v8 — 2026-10-14 SECURITE : version de session (sv) dans le jeton. Un changement / une réinitialisation
//   du mot de passe incrémente clients_luxyra.session_version : les jetons des autres appareils sont refusés par lx-profile.
// lx-login v6 — SECURITE 2026-10-08 : limite de tentatives (8 echecs / 15 min par email, 30 par IP) et
// reponse limitee aux champs utiles (plus la ligne complete). v5 : monitoring 100%
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { create as jwtCreate, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";
const SB_URL = Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL")!;
const SB_SR  = Deno.env.get("SB_SERVICE_ROLE") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LX_SECRET = Deno.env.get("LX_SESSION_SECRET") || Deno.env.get("BP_SESSION_SECRET") || SB_SR;
const sb = createClient(SB_URL, SB_SR, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s:number,b:unknown){return new Response(JSON.stringify(b),{status:s,headers:{...CORS,"Content-Type":"application/json"}});}
{ const _LX_FN="lx-login"; const _LX_URL=Deno.env.get("SB_URL")||Deno.env.get("SUPABASE_URL")||""; const _LX_SR=Deno.env.get("SB_SERVICE_ROLE")||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||""; const _lxReport=async(msg:string,sev:"warning"|"error"|"critical",err?:unknown,ctx?:Record<string,unknown>)=>{try{await fetch(_LX_URL+"/rest/v1/rpc/report_server_error",{method:"POST",headers:{"Content-Type":"application/json","apikey":_LX_SR,"Authorization":"Bearer "+_LX_SR},body:JSON.stringify({p_source:"edge_fn:"+_LX_FN,p_message:String(msg||"").slice(0,800),p_severity:sev,p_stack:(err as Error)?.stack?String((err as Error).stack).slice(0,3000):null,p_context:ctx||null})});}catch(_){}}; (globalThis as any).__lxReport=_lxReport; const _orig=Deno.serve; (Deno as any).serve=(handler:any,opts?:any)=>_orig(async(req:Request)=>{try{const res=await handler(req); if(res&&res.status>=500){const body=await res.clone().text().catch(()=>""); await _lxReport("HTTP "+res.status,"error",undefined,{url:req.url,body:body.slice(0,500)});} return res;}catch(e){const err=e as Error; await _lxReport("Exception non gérée: "+(err?.message||String(e)),"critical",err,{url:req.url}); return new Response(JSON.stringify({error:"Internal server error"}),{status:500,headers:{"Content-Type":"application/json"}});}}, opts); }
function toHex(buf: ArrayBuffer | Uint8Array): string { const arr = buf instanceof Uint8Array ? buf : new Uint8Array(buf); return Array.from(arr).map((b)=>b.toString(16).padStart(2,"0")).join(""); }
function fromHex(hex: string): Uint8Array { const arr = new Uint8Array(hex.length/2); for (let i=0; i<arr.length; i++) arr[i] = parseInt(hex.substr(i*2,2),16); return arr; }
function timingSafeEqual(a: string, b: string): boolean { if (a.length !== b.length) return false; let r = 0; for (let i=0; i<a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
async function sha256Hex(s: string): Promise<string> { return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))); }
async function pbkdf2Hash(password: string, salt: Uint8Array, iterations: number): Promise<string> { const km = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]); const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, km, 256); return toHex(bits); }
async function hashPassword(password: string): Promise<string> { const salt = crypto.getRandomValues(new Uint8Array(16)); const it = 120_000; return `pbkdf2$${it}$${toHex(salt)}$${await pbkdf2Hash(password, salt, it)}`; }
type VerifyResult = "valid-modern" | "valid-legacy" | "invalid";
async function verifyPassword(password: string, email: string, stored: string): Promise<VerifyResult> {
  if (!stored) return "invalid";
  if (stored.startsWith("pbkdf2$")) { const parts = stored.split("$"); if (parts.length !== 4) return "invalid"; const iter = parseInt(parts[1],10); if (!iter || iter < 1000) return "invalid"; const salt = fromHex(parts[2]); const computed = await pbkdf2Hash(password, salt, iter); return timingSafeEqual(computed, parts[3]) ? "valid-modern" : "invalid"; }
  const salted = await sha256Hex(email + ":" + password);
  const unsalted = await sha256Hex(password);
  if (timingSafeEqual(stored, salted)) return "valid-legacy";
  if (timingSafeEqual(stored, unsalted)) return "valid-legacy";
  return "invalid";
}
async function signSession(lx_id: string, email: string, sv: number): Promise<string> { const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(LX_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign","verify"]); return await jwtCreate({ alg: "HS256", typ: "JWT" }, { lx_id, bp_id: lx_id, email, sv, iat: getNumericDate(0), exp: getNumericDate(60*60*24*30) }, key); }
async function tropDeTentatives(email: string, ip: string): Promise<boolean> {
  try {
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const [{ count: parEmail }, { count: parIp }] = await Promise.all([
      sb.from("login_attempts").select("id", { count: "exact", head: true }).eq("email", email).eq("ok", false).gte("at", since),
      ip ? sb.from("login_attempts").select("id", { count: "exact", head: true }).eq("ip", ip).eq("ok", false).gte("at", since) : Promise.resolve({ count: 0 } as any),
    ]);
    return (parEmail || 0) >= 8 || (parIp || 0) >= 30;
  } catch { return false; }
}
async function noter(email: string, ip: string, ok: boolean) { try { await sb.from("login_attempts").insert({ email, ip: ip || null, ok }); } catch {} }
const CHAMPS_PUBLICS = "id,email,nom,prenom,telephone,date_naissance,genre,sms_ok,email_ok,email_verified,avatar_url,adresse,cp,ville,created_at,last_login";
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  try {
    const body = await req.json().catch(() => null);
    if (!body) return json(400, { error: "Invalid JSON body" });
    const email = String(body.email || "").toLowerCase().trim().slice(0, 200);
    const password = String(body.password || "");
    if (!email || !password) return json(400, { error: "Email et mot de passe requis" });
    const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0].trim().slice(0, 64);
    if (await tropDeTentatives(email, ip)) return json(429, { error: "Trop de tentatives. Réessayez dans 15 minutes ou utilisez « mot de passe oublié »." });
    const { data: users } = await sb.from("clients_luxyra").select("id, email, password_hash, session_version").eq("email", email).limit(1);
    if (!users || users.length === 0) { await pbkdf2Hash(password, new Uint8Array(16), 120_000); await noter(email, ip, false); return json(401, { error: "Email ou mot de passe incorrect" }); }
    const user = users[0];
    const check = await verifyPassword(password, email, user.password_hash || "");
    if (check === "invalid") { await noter(email, ip, false); return json(401, { error: "Email ou mot de passe incorrect" }); }
    if (check === "valid-legacy") { const newHash = await hashPassword(password); await sb.from("clients_luxyra").update({ password_hash: newHash }).eq("id", user.id); }
    await sb.from("clients_luxyra").update({ last_login: new Date().toISOString() }).eq("id", user.id);
    await noter(email, ip, true);
    const session_token = await signSession(user.id, user.email, Number(user.session_version) || 0);
    const { data: safe } = await sb.from("clients_luxyra").select(CHAMPS_PUBLICS).eq("id", user.id).single();
    return json(200, { user: safe || { id: user.id, email: user.email }, session_token });
  } catch (e) {
    console.error("lx-login unexpected", e);
    return json(500, { error: "Erreur interne" });
  }
});
