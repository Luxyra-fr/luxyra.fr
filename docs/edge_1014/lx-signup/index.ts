// lx-signup v10 — 2026-10-14 audit : mot de passe 8 caractères minimum (comme partout ailleurs).
// ⚠ Le lot « secu » modifie aussi lx-signup (vérification de l'e-mail) : fusionner les deux versions
//   (seul changement de ce lot : la ligne « password.length < 8 »).
// lx-signup v9 — v8 + « Autre pays » (2026-10-13)
// lx-signup v8 — pays (France / Allemagne / Luxembourg / Belgique / Suisse)
// lx-signup v7 — adresse / code postal / ville enregistrés dès la création (utile pour les RDV à domicile)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { create as jwtCreate, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";
const SB_URL = Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL")!;
const SB_SR  = Deno.env.get("SB_SERVICE_ROLE") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LX_SECRET = Deno.env.get("LX_SESSION_SECRET") || Deno.env.get("BP_SESSION_SECRET") || SB_SR;
const sb = createClient(SB_URL, SB_SR, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const PAYS = ["France","Allemagne","Luxembourg","Belgique","Suisse","Autre pays"];
function json(s:number,b:unknown){return new Response(JSON.stringify(b),{status:s,headers:{...CORS,"Content-Type":"application/json"}});}
{ const _LX_FN="lx-signup"; const _LX_URL=Deno.env.get("SB_URL")||Deno.env.get("SUPABASE_URL")||""; const _LX_SR=Deno.env.get("SB_SERVICE_ROLE")||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||""; const _lxReport=async(msg:string,sev:"warning"|"error"|"critical",err?:unknown,ctx?:Record<string,unknown>)=>{try{await fetch(_LX_URL+"/rest/v1/rpc/report_server_error",{method:"POST",headers:{"Content-Type":"application/json","apikey":_LX_SR,"Authorization":"Bearer "+_LX_SR},body:JSON.stringify({p_source:"edge_fn:"+_LX_FN,p_message:String(msg||"").slice(0,800),p_severity:sev,p_stack:(err as Error)?.stack?String((err as Error).stack).slice(0,3000):null,p_context:ctx||null})});}catch(_){}}; (globalThis as any).__lxReport=_lxReport; const _orig=Deno.serve; (Deno as any).serve=(handler:any,opts?:any)=>_orig(async(req:Request)=>{try{const res=await handler(req); if(res&&res.status>=500){const body=await res.clone().text().catch(()=>""); await _lxReport("HTTP "+res.status,"error",undefined,{url:req.url,body:body.slice(0,500)});} return res;}catch(e){const err=e as Error; await _lxReport("Exception non gérée: "+(err?.message||String(e)),"critical",err,{url:req.url}); return new Response(JSON.stringify({error:"Internal server error"}),{status:500,headers:{"Content-Type":"application/json"}});}}, opts); }
function toHex(buf: ArrayBuffer | Uint8Array): string { const arr = buf instanceof Uint8Array ? buf : new Uint8Array(buf); return Array.from(arr).map((b)=>b.toString(16).padStart(2,"0")).join(""); }
async function pbkdf2Hash(password: string, salt: Uint8Array, iterations: number): Promise<string> { const km = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]); const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, km, 256); return toHex(bits); }
async function hashPassword(password: string): Promise<string> { const salt = crypto.getRandomValues(new Uint8Array(16)); const it = 120_000; return `pbkdf2$${it}$${toHex(salt)}$${await pbkdf2Hash(password, salt, it)}`; }
async function signSession(lx_id: string, email: string): Promise<string> { const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(LX_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]); return await jwtCreate({ alg: "HS256", typ: "JWT" }, { lx_id, bp_id: lx_id, email, iat: getNumericDate(0), exp: getNumericDate(60*60*24*30) }, key); }
async function isPasswordPwned(password: string): Promise<boolean> { try { const sha1 = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(password)); const hashHex = toHex(sha1).toUpperCase(); const prefix = hashHex.slice(0,5); const suffix = hashHex.slice(5); const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, { headers: { "Add-Padding":"true","User-Agent":"Luxyra-LX" } }); if (!res.ok) return false; const text = await res.text(); for (const line of text.split("\n")) { const parts = line.trim().split(":"); if (parts[0] === suffix && parseInt(parts[1],10) > 0) return true; } return false; } catch { return false; } }
const _txt = (v: unknown, max: number) => { const s = String(v == null ? "" : v).trim().slice(0, max); return s || null; };
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
    if (!email || !email.includes("@")) return json(400, { error: "Email invalide" });
    if (password.length < 8) return json(400, { error: "Mot de passe trop court (8 caractères minimum)" }); // 2026-10-14 audit
    if (!nom || !prenom) return json(400, { error: "Nom et prénom requis" });
    if (await isPasswordPwned(password)) return json(400, { error: "Ce mot de passe a été exposé dans une fuite de données connue. Choisissez-en un autre plus unique." });
    const { data: existing } = await sb.from("clients_luxyra").select("id").eq("email", email).limit(1);
    if (existing && existing.length > 0) return json(409, { error: "Un compte existe déjà avec cet email. Connectez-vous." });
    const password_hash = await hashPassword(password);
    const pays = PAYS.includes(String(body.pays || "")) ? String(body.pays) : "France";
    const { data: user, error } = await sb.from("clients_luxyra").insert({ email, password_hash, nom, prenom, telephone, date_naissance: body.date_naissance || null, genre: body.genre || null, sms_ok: body.sms_ok ?? true, email_ok: body.email_ok ?? true, email_verified: false, adresse: _txt(body.adresse, 200), cp: _txt(body.cp, 10), ville: _txt(body.ville, 80), pays }).select().single();
    if (error) { console.error("lx-signup insert error", error); await (globalThis as any).__lxReport?.("Insert clients_luxyra échec: "+error.message, "error", undefined, { email }); return json(500, { error: error.message }); }
    const session_token = await signSession(user.id, user.email);
    const { password_hash: _ph, ...safe } = user;
    return json(200, { user: safe, session_token });
  } catch (e) {
    console.error("lx-signup unexpected", e);
    return json(500, { error: String((e as Error)?.message || e) });
  }
});
