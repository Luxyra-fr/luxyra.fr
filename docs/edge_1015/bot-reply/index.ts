// bot-reply v14 — 2026-10-15 BOÎTE DE SUPPORT : passage de main explicite (support_conversations.escalade_bot /
// escalade_le / escalade_motif : 'bot', 'piece_jointe', 'erreur_bot') ; pièces jointes signalées au modèle et passage
// direct à un humain quand le dernier message du pro contient une capture (le bot ne voit pas les images) ; en cas
// d'erreur de l'API, le pro est prévenu (message de transfert) au lieu d'attendre sans réponse. Les notes internes
// (table support_notes) ne sont JAMAIS lues ici : seule support_messages est chargée.
// À déployer APRÈS docs/migrations_1015/support_chat.sql (colonnes escalade_* et pieces).
// v13 — SECURITE 2026-10-07 : appel reserve au role service (declencheur base) ; salon deduit de la conversation. v12 : base de connaissances lue en base (table support_bot_kb, mise a jour sans redeploiement), contexte salon enrichi (TVA, verrouillage), regles anti-invention
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SB_URL = Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL")!;
const SB_SR  = Deno.env.get("SB_SERVICE_ROLE") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(SB_URL, SB_SR, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
{ const _LX_FN="bot-reply"; const _LX_URL=Deno.env.get("SB_URL")||Deno.env.get("SUPABASE_URL")||""; const _LX_SR=Deno.env.get("SB_SERVICE_ROLE")||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||""; const _lxReport=async(msg:string,sev:"warning"|"error"|"critical",err?:unknown,ctx?:Record<string,unknown>)=>{try{await fetch(_LX_URL+"/rest/v1/rpc/report_server_error",{method:"POST",headers:{"Content-Type":"application/json","apikey":_LX_SR,"Authorization":"Bearer "+_LX_SR},body:JSON.stringify({p_source:"edge_fn:"+_LX_FN,p_message:String(msg||"").slice(0,800),p_severity:sev,p_stack:(err as Error)?.stack?String((err as Error).stack).slice(0,3000):null,p_context:ctx||null})});}catch(_){}}; (globalThis as any).__lxReport=_lxReport; const _orig=Deno.serve; (Deno as any).serve=(handler:any,opts?:any)=>_orig(async(req:Request)=>{try{const res=await handler(req); if(res&&res.status>=500){const body=await res.clone().text().catch(()=>""); await _lxReport("HTTP "+res.status,"error",undefined,{url:req.url,body:body.slice(0,500)});} return res;}catch(e){const err=e as Error; await _lxReport("Exception non gérée: "+(err?.message||String(e)),"critical",err,{url:req.url}); return new Response(JSON.stringify({error:"Internal server error"}),{status:500,headers:{"Content-Type":"application/json"}});}}, opts); }

const BASE_PROMPT = `Tu es l'assistant support de Luxyra, logiciel de gestion pour salons de coiffure, barbiers, instituts de beauté, ongleries et centres de bien-être (France). Tu aides les professionnels qui utilisent l'application : planning, encaissement, caisse, clients, prestations, équipe, bons cadeaux, fidélité, SMS, site de réservation.

Méthode :
1. Repère le thème de la question dans la BASE DE CONNAISSANCES ci-dessous.
2. Si la réponse s'y trouve : donne le chemin EXACT (libellés entre « »), en 2 à 5 phrases courtes, ou en étapes numérotées si c'est une manipulation. Vouvoiement.
3. Tiens compte du CONTEXTE du salon (forfait, TVA, verrouillage…) : si une fonction est réservée au forfait Pro et que le salon est en Essentiel, dis-le.
4. Si la réponse n'est pas dans la base, ou si tu as le moindre doute : réponds UNIQUEMENT <ESCALATE/>.
5. Salutations et remerciements : réponds en une phrase, sans liste.

Règles absolues :
- Ne cite JAMAIS un menu, onglet, bouton, réglage ou délai absent de la base de connaissances.
- N'invoque JAMAIS la loi, la NF525, l'administration fiscale ou la sécurité pour justifier une contrainte, sauf si la base le dit explicitement.
- Toute question fiscale, comptable ou juridique (quel taux appliquer, obligations, déclarations) ou sur la facturation de l'abonnement Luxyra : <ESCALATE/>. Les manipulations de caisse décrites dans la base (avoir, annulation) peuvent être expliquées.
- Si la personne signale un bug, une donnée disparue ou qui ne reste pas enregistrée, un montant faux, un blocage, ou dit ne pas trouver ce que tu as indiqué : <ESCALATE/> immédiatement.
- Quand il faut passer la main (base qui indique <ESCALATE/>, question hors base, doute) : ta réponse ENTIÈRE est exactement <ESCALATE/>, sans aucun autre texte. Tu ES le support : ne renvoie jamais vers « Contacter le support ».
- N'invente aucune étape ni aucun bouton : pas de « Valider », « Enregistrer » ou « Sélectionnez » si la base ne les mentionne pas.
- N'ajoute pas d'actions que la personne n'a pas demandées.
- Mise en forme : texte simple, pas de titres ; étapes numérotées « 1. », « 2. »… une par ligne ; au plus quelques mots en **gras**.
- Ne propose aucun contournement technique (vider le cache, réinstaller, changer de navigateur…).
- Réponds sans préfixe « 🤖 » ni « Assistant : ».`;


const KB_SECOURS = `Menu Paramètres (⚙️ sur l'accueil) : Établissement ; Horaires ; Équipe ; Affichage planning ; Apparence ; Infos établissement ; Site en ligne ; Options commerciales ; Caisse et paiements ; Paiements en ligne ; SMS et Marketing ; NF525 ; Mes factures ; Mes documents ; Notifications push ; Migration depuis ancien logiciel ; Support Luxyra. Il n'existe pas de rubrique « Sécurité ».`;
async function chargerBase(): Promise<string> {
  try {
    const { data, error } = await sb.from("support_bot_kb").select("titre,contenu,ordre").eq("actif", true).order("ordre", { ascending: true });
    if (error || !data || !data.length) { await (globalThis as any).__lxReport?.("bot-reply : base de connaissances illisible, secours utilise : "+(error?.message||"vide"), "warning"); return KB_SECOURS; }
    return data.map((r: any) => "### " + r.titre + "\n" + r.contenu).join("\n\n");
  } catch (e) { return KB_SECOURS; }
}

function buildContext(salon: any, cfg: any): string {
  if (!salon) return "CONTEXTE : salon inconnu.";
  const lines: string[] = [];
  lines.push(`CONTEXTE du salon qui pose la question :`);
  lines.push(`- Nom : ${salon.nom || "—"}`);
  lines.push(`- Métier : ${salon.metier || "non renseigné"}`);
  lines.push(`- Mode activité : ${salon.mode_activite || "salon fixe"}`);
  lines.push(`- Forfait actuel : ${salon.plan === "pro" ? "Pro (24,99€)" : salon.plan === "essential" ? "Essentiel (14,99€)" : salon.plan || "inconnu"}`);
  lines.push(`- Statut abonnement : ${salon.status || "inconnu"}${salon.is_free ? " (compte offert)" : ""}`);
  const sc = salon.stripe_connect_status;
  if (sc === "active" || sc === "enabled") lines.push(`- Stripe Connect : ACTIVÉ`);
  else if (sc === "pending" || sc === "restricted") lines.push(`- Stripe Connect : EN ATTENTE`);
  else lines.push(`- Stripe Connect : NON ACTIVÉ`);
  if (cfg) {
    lines.push(`- Site web : ${cfg.site_actif ? "ACTIF" : "INACTIF"}`);
    lines.push(`- Réservation : ${cfg.reservation_active ? "ACTIVE" : "INACTIVE"}`);
    lines.push(`- Boutique : ${cfg.boutique_active ? "ACTIVE" : "INACTIVE"}`);
    lines.push(`- Acompte obligatoire : ${cfg.acompte_obligatoire ? `OUI (${cfg.acompte_montant || 0}${cfg.acompte_type === "percent" ? "%" : "€"})` : "NON"}`);
    lines.push(`- Fidélité : ${cfg.fidelite_active ? `ACTIVE (seuil ${cfg.fidelite_seuil || 0})` : "INACTIVE"}`);
    lines.push(`- Délai min/max : ${cfg.delai_min_heures || 0}h / ${cfg.delai_max_jours || 0}j`);
    lines.push(`- Confirmation auto : ${cfg.confirmation_auto ? "OUI" : "NON"}`);
  }
  lines.push(`- SMS : ${salon.sms_mode || "Brevo"} — ${salon.sms_credits || 0} crédits (+ ${salon.sms_monthly_free || 0} offerts/mois)`);
  let cj: any = {};
  try { cj = typeof salon.config_json === "string" ? JSON.parse(salon.config_json) : (salon.config_json || {}); } catch (_) { cj = {}; }
  const tva = (salon.taux_tva === null || salon.taux_tva === undefined) ? 20 : Number(salon.taux_tva);
  lines.push(`- TVA appliquée : ${tva} %${tva === 0 ? " (franchise de TVA)" : ""} ; forme juridique : ${salon.forme_juridique || "non renseignée"}`);
  const vm = (typeof cj.verrouillage_min === "number") ? cj.verrouillage_min : 5;
  lines.push(`- Verrouillage automatique : ${vm === 0 ? "Jamais en journée" : vm + " min"}`);
  if (cfg && Array.isArray(cfg.collaborateurs) && cfg.collaborateurs.length) {
    lines.push(`- Équipe (${cfg.collaborateurs.length}) : ${cfg.collaborateurs.map((c:any)=>(c.n||c.nom||c.name||"?")+((c.actif===false||c.active===false)?" (désactivé)":"")).join(", ")}`);
  } else lines.push(`- Équipe : solo`);
  return lines.join("\n");
}

const MSG_TRANSFERT = "🙋 Je transmets votre demande à un humain qui vous répondra rapidement.";
// 2026-10-15 : passage de main EXPLICITE (filtre « Escaladés par le bot » de l'admin, revue du bot).
// Le message de transfert est inséré avec read_by_admin = false (le déclencheur trg_support_escalade le reconnaît aussi).
async function passerLaMain(conversation_id: string, salon_id: string, motif: "bot" | "piece_jointe" | "erreur_bot") {
  await sb.from("support_conversations").update({ bot_active: false, escalade_bot: true, escalade_le: new Date().toISOString(), escalade_motif: motif }).eq("id", conversation_id);
  await sb.from("support_messages").insert({ conversation_id, salon_id, sender: "bot", message: MSG_TRANSFERT, read_by_admin: false, read_by_client: true });
}
function nbPieces(m: any): number { return Array.isArray(m && m.pieces) ? m.pieces.length : 0; }

function _lxRoleDuJeton(t: string): string { try { const p = t.split(".")[1]; return String(JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/"))).role || ""); } catch { return ""; } }
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const _jt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (_lxRoleDuJeton(_jt) !== "service_role") return new Response(JSON.stringify({ error: "reserve au service" }), { status: 403, headers: { ...CORS, "Content-Type": "application/json" } });
  try {
    const { conversation_id } = await req.json();
    if (!conversation_id) return new Response(JSON.stringify({ error: "conversation_id requis" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    const { data: conv } = await sb.from("support_conversations").select("bot_active,status,salon_id").eq("id", conversation_id).single();
    const salon_id = conv && conv.salon_id;
    if (!conv || !salon_id || conv.bot_active === false) return new Response(JSON.stringify({ skipped: "bot disabled" }), { headers: { ...CORS, "Content-Type": "application/json" } });
    // Uniquement support_messages (jamais support_notes : notes internes de l'équipe)
    const { data: msgs } = await sb.from("support_messages").select("sender,message,pieces,created_at").eq("conversation_id", conversation_id).order("created_at", { ascending: false }).limit(20);
    if (!msgs || !msgs.length) return new Response(JSON.stringify({ skipped: "no messages" }), { headers: { ...CORS, "Content-Type": "application/json" } });
    msgs.reverse();
    // Dernier message du pro avec une capture / un PDF : le bot ne peut pas le lire -> humain directement
    const dernierPro = [...msgs].reverse().find((m: any) => m.sender === "client");
    if (dernierPro && nbPieces(dernierPro) > 0 && msgs[msgs.length - 1].sender === "client") {
      await passerLaMain(conversation_id, salon_id, "piece_jointe");
      return new Response(JSON.stringify({ escalated: true, motif: "piece_jointe" }), { headers: { ...CORS, "Content-Type": "application/json" } });
    }
    const [{ data: salon }, { data: cfgRows }] = await Promise.all([
      sb.from("salons").select("nom,metier,mode_activite,plan,status,is_free,stripe_connect_status,sms_mode,sms_credits,sms_monthly_free,taux_tva,forme_juridique,config_json").eq("id", salon_id).single(),
      sb.from("site_config").select("site_actif,reservation_active,boutique_active,acompte_obligatoire,acompte_montant,acompte_type,delai_min_heures,delai_max_jours,confirmation_auto,fidelite_active,fidelite_seuil,collaborateurs,horaires_salon,absences").eq("salon_id", salon_id).limit(1),
    ]);
    const cfg = cfgRows && cfgRows[0];
    const messages = msgs.map((m: any) => {
      const n = nbPieces(m);
      const txt = String(m.message || "").trim() + (n ? `\n[${n} pièce(s) jointe(s) envoyée(s) — illisible(s) pour l'assistant]` : "");
      return { role: (m.sender === "client") ? "user" : "assistant", content: txt || "…" };
    });
    while (messages.length && messages[messages.length - 1].role === "assistant") messages.pop();
    if (!messages.length) return new Response(JSON.stringify({ skipped: "no user msg" }), { headers: { ...CORS, "Content-Type": "application/json" } });
    while (messages.length && messages[0].role === "assistant") messages.shift();
    const base = await chargerBase();
    const fullSystem = BASE_PROMPT + "\n\n=== BASE DE CONNAISSANCES (source unique et vérifiée) ===\n" + base + "\n\n=== CONTEXTE ===\n" + buildContext(salon, cfg);
    const aiRes = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 500, system: fullSystem, messages }) });
    if (!aiRes.ok) {
      const errTxt = await aiRes.text(); console.error("Anthropic API error:", errTxt);
      await (globalThis as any).__lxReport?.("Anthropic API HTTP "+aiRes.status+": "+errTxt.slice(0,300), "error", undefined, { conversation_id, salon_id });
      await passerLaMain(conversation_id, salon_id, "erreur_bot");
      return new Response(JSON.stringify({ error: "api_failure_escalated" }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
    }
    const aiData = await aiRes.json();
    const text = (aiData.content && aiData.content[0] && aiData.content[0].text) || "";
    if (text.includes("<ESCALATE/>") || !text.trim()) {
      await passerLaMain(conversation_id, salon_id, "bot");
      return new Response(JSON.stringify({ escalated: true }), { headers: { ...CORS, "Content-Type": "application/json" } });
    }
    await sb.from("support_messages").insert({ conversation_id, salon_id, sender: "bot", message: text.trim(), read_by_admin: true, read_by_client: false });
    return new Response(JSON.stringify({ replied: true, tokens: aiData.usage }), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("bot-reply error:", e);
    return new Response(JSON.stringify({ error: "Erreur interne" }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
