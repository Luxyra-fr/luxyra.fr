// send-push v21 (2026-10-31) — v20 + journal des abonnements expirés (410/404) retirés et résumé de chaque envoi admin.
// v20 : notifications des CLIENTS (target_client_id -> client_push_subscriptions), réservé au rôle service / admin (2026-10-13).
// v19 : alias de types envoyes par la base (chat -> admin_reply, inscription -> new_signup).
// v18 : SECURITE 2026-10-07 : appelant authentifie obligatoire.
import webpush from "https://esm.sh/web-push@3.6.7";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VAPID_PUBLIC  = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:contact@luxyra.fr";
const SB_URL = Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL")!;
const SB_SR  = Deno.env.get("SB_SERVICE_ROLE") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const COLONNES_EVENEMENTS = ["admin_reply","new_signup","payment_failed","critical","migration"];
const ALIAS: Record<string,string> = { chat: "admin_reply", support: "admin_reply", inscription: "new_signup", signup: "new_signup", paiement: "payment_failed", stripe: "payment_failed" };

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}
const sb = createClient(SB_URL, SB_SR, { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const J = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// 2026-10-31 : type d'appareil lisible (jamais l'adresse complète de l'abonnement)
function _lxTypeAppareil(e: string): string { return /fcm\.googleapis\.com/.test(e) ? "Chrome/Android" : /notify\.windows\.com/.test(e) ? "Windows" : /push\.apple\.com/.test(e) ? "Apple" : /mozilla/.test(e) ? "Firefox" : "autre"; }

function _lxRoleDuJeton(t: string): string { try { const p = t.split(".")[1]; return String(JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/"))).role || ""); } catch { return ""; } }
async function _lxAppelant(req: Request): Promise<{ kind: "service" | "admin" | "salon"; salonIds?: string[] } | null> {
  const t = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!t) return null;
  if (_lxRoleDuJeton(t) === "service_role") return { kind: "service" };
  try {
    const { data } = await sb.auth.getUser(t);
    const user = data && data.user;
    if (!user) return null;
    if (String(user.email || "").toLowerCase() === "support@luxyra.fr") return { kind: "admin" };
    const { data: s } = await sb.from("salons").select("id").eq("user_id", user.id);
    return { kind: "salon", salonIds: (s || []).map((x: any) => String(x.id)) };
  } catch { return null; }
}

{ const _LX_FN="send-push"; const _LX_URL=Deno.env.get("SB_URL")||Deno.env.get("SUPABASE_URL")||""; const _LX_SR=Deno.env.get("SB_SERVICE_ROLE")||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||""; const _lxReport=async(msg:string,sev:"warning"|"error"|"critical",err?:unknown,ctx?:Record<string,unknown>)=>{try{await fetch(_LX_URL+"/rest/v1/rpc/report_server_error",{method:"POST",headers:{"Content-Type":"application/json","apikey":_LX_SR,"Authorization":"Bearer "+_LX_SR},body:JSON.stringify({p_source:"edge_fn:"+_LX_FN,p_message:String(msg||"").slice(0,800),p_severity:sev,p_stack:(err as Error)?.stack?String((err as Error).stack).slice(0,3000):null,p_context:ctx||null})});}catch(_){}}; (globalThis as any).__lxReport=_lxReport; const _orig=Deno.serve; (Deno as any).serve=(handler:any,opts?:any)=>_orig(async(req:Request)=>{try{const res=await handler(req); if(res&&res.status>=500){const body=await res.clone().text().catch(()=>""); await _lxReport("HTTP "+res.status,"error",undefined,{url:req.url,body:body.slice(0,500)});} return res;}catch(e){const err=e as Error; await _lxReport("Exception non gérée: "+(err?.message||String(e)),"critical",err,{url:req.url}); return new Response(JSON.stringify({error:"Internal server error"}),{status:500,headers:{"Content-Type":"application/json"}});}}, opts); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return J(503, { error: "VAPID keys non configurées" });
  try {
    const appelant = await _lxAppelant(req);
    if (!appelant) return J(401, { error: "Authentification requise" });
    const { event_type, title, body, url, target_user_id, target_salon_id, target_client_id, payload } = await req.json();
    if (!event_type || !title) return J(400, { error: "event_type & title requis" });

    // 2026-10-13 : notification d'un CLIENT (appli clients) — uniquement depuis le serveur (service) ou l'admin
    if (target_client_id) {
      if (appelant.kind === "salon") return J(403, { error: "Accès refusé" });
      const { data: subs, error } = await sb.from("client_push_subscriptions").select("id,endpoint,p256dh,auth").eq("client_luxyra_id", target_client_id);
      if (error) throw error;
      const notif = JSON.stringify({
        title: String(title).slice(0, 120), body: String(body || "").slice(0, 400),
        icon: "https://luxyra.fr/icon-192.png", badge: "https://luxyra.fr/badge-72.png",
        data: { url: (typeof url === "string" && url.startsWith("https://luxyra.fr/")) ? url : "https://luxyra.fr/compte.html?tab=notifs", event_type },
        tag: "client_" + event_type + "_" + Date.now(),
      });
      let sent = 0, failed = 0; const toClean: number[] = [];
      await Promise.all((subs || []).map(async (s: any) => {
        try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, notif, { TTL: 86400, urgency: "high" }); sent++;
          await sb.from("client_push_subscriptions").update({ last_used_at: new Date().toISOString() }).eq("id", s.id);
        } catch (e: any) { failed++; if (e?.statusCode === 410 || e?.statusCode === 404) toClean.push(s.id); }
      }));
      if (toClean.length) await sb.from("client_push_subscriptions").delete().in("id", toClean);
      return J(200, { sent, failed, cleaned: toClean.length, mode: "client" });
    }

    if (appelant.kind === "salon") {
      if (!target_salon_id || !(appelant.salonIds || []).includes(String(target_salon_id))) return J(403, { error: "Accès refusé" });
    }
    const safeUrl = (appelant.kind === "salon") ? "https://luxyra.fr/app.html" : url;

    let q = sb.from("push_subscriptions").select("id,endpoint,p256dh,auth,admin_user_id,salon_id,target_type");
    let filtreUtilise = "";
    if (target_salon_id) {
      q = q.eq("target_type", "salon").eq("salon_id", target_salon_id);
      filtreUtilise = "salon";
    } else {
      const typeCol = ALIAS[event_type] || event_type;
      const col = COLONNES_EVENEMENTS.includes(typeCol) ? `events_${typeCol}` : "events_critical";
      filtreUtilise = col;
      q = q.eq(col, true);
      q = q.or("target_type.eq.admin,target_type.is.null");
      if (target_user_id) q = q.eq("admin_user_id", target_user_id);
    }

    const { data: subs, error } = await q;
    if (error) throw error;

    const defaultUrl = target_salon_id ? "https://luxyra.fr/app.html" : "https://luxyra.fr/admin";
    const uniqueId = (payload && (payload.notification_id || payload.rdv_id)) || null;
    const tag = target_salon_id
      ? (uniqueId ? `${event_type}_${target_salon_id}_${uniqueId}` : `${event_type}_${target_salon_id}`)
      : (event_type + "_" + Date.now());

    const notif = JSON.stringify({
      title: String(title).slice(0, 120),
      body: String(body || "").slice(0, 400),
      icon: "https://luxyra.fr/icon-192.png",
      badge: "https://luxyra.fr/badge-72.png",
      data: { url: safeUrl || defaultUrl, event_type, ...(payload || {}) },
      tag,
      requireInteraction: event_type === "admin_reply",
    });

    const sendOpts = { TTL: 86400, urgency: "high" as const };
    let sent = 0, failed = 0;
    const toClean: number[] = [];
    const typesRetires: string[] = [];
    const errors: string[] = [];
    await Promise.all((subs || []).map(async (s: any) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, notif, sendOpts);
        sent++;
        await sb.from("push_subscriptions").update({ last_used_at: new Date().toISOString() }).eq("id", s.id);
      } catch (e: any) {
        failed++;
        errors.push(`${s.id}:${e?.statusCode || "?"}:${String(e?.body || e?.message || "").slice(0, 120)}`);
        if (e?.statusCode === 410 || e?.statusCode === 404) { toClean.push(s.id); typesRetires.push(_lxTypeAppareil(String(s.endpoint || ""))); }
      }
    }));

    let cleaned = 0;
    if (toClean.length) {
      const { count } = await sb.from("push_subscriptions").delete({ count: "exact" }).in("id", toClean);
      cleaned = count || toClean.length;
    }
    // 2026-10-31 : un appareil ADMIN dont l'abonnement a expiré est désormais signalé (avant : supprimé en silence ->
    // plus aucune notification sans que personne ne le sache). L'admin le recrée seule à sa prochaine ouverture.
    const mode = target_salon_id ? "salon" : "admin";
    console.log(`[send-push] ${mode} ${event_type} : ${sent} envoyée(s), ${failed} échec(s), ${cleaned} abonnement(s) expiré(s) retiré(s)`);
    if (mode === "admin" && toClean.length) {
      try { await (globalThis as any).__lxReport?.(`Notifications admin : ${toClean.length} abonnement(s) expiré(s) retiré(s) (${typesRetires.join(", ")}) — rouvrir l'admin sur l'appareil concerné pour le réinscrire automatiquement`, "warning", undefined, { event_type, sent, failed }); } catch (_) {}
    }
    return J(200, { sent, failed, cleaned, mode, filtre: filtreUtilise, urgency: "high", tag, errors: appelant.kind === "salon" ? [] : errors });
  } catch (e: any) {
    return J(500, { error: "Erreur interne" });
  }
});
