// lx-bot-eval v3 — banc d essai du bot support (memes consigne, base et contexte que bot-reply), AUCUNE ecriture. Reserve au role service.
// copie de bot-reply v12 — base de connaissances lue en base (table support_bot_kb, mise a jour sans redeploiement), contexte salon enrichi (TVA, verrouillage), regles anti-invention
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SB_URL = Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL")!;
const SB_SR  = Deno.env.get("SB_SERVICE_ROLE") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(SB_URL, SB_SR, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
{ const _LX_FN="lx-bot-eval"; const _LX_URL=Deno.env.get("SB_URL")||Deno.env.get("SUPABASE_URL")||""; const _LX_SR=Deno.env.get("SB_SERVICE_ROLE")||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||""; const _lxReport=async(msg:string,sev:"warning"|"error"|"critical",err?:unknown,ctx?:Record<string,unknown>)=>{try{await fetch(_LX_URL+"/rest/v1/rpc/report_server_error",{method:"POST",headers:{"Content-Type":"application/json","apikey":_LX_SR,"Authorization":"Bearer "+_LX_SR},body:JSON.stringify({p_source:"edge_fn:"+_LX_FN,p_message:String(msg||"").slice(0,800),p_severity:sev,p_stack:(err as Error)?.stack?String((err as Error).stack).slice(0,3000):null,p_context:ctx||null})});}catch(_){}}; (globalThis as any).__lxReport=_lxReport; const _orig=Deno.serve; (Deno as any).serve=(handler:any,opts?:any)=>_orig(async(req:Request)=>{try{const res=await handler(req); if(res&&res.status>=500){const body=await res.clone().text().catch(()=>""); await _lxReport("HTTP "+res.status,"error",undefined,{url:req.url,body:body.slice(0,500)});} return res;}catch(e){const err=e as Error; await _lxReport("Exception non gérée: "+(err?.message||String(e)),"critical",err,{url:req.url}); return new Response(JSON.stringify({error:"Internal server error"}),{status:500,headers:{"Content-Type":"application/json"}});}}, opts); }

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


function roleDuJeton(req: Request): string {
  try { const t=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,""); const p=t.split(".")[1]; const j=JSON.parse(atob(p.replace(/-/g,"+").replace(/_/g,"/"))); return String(j.role||""); } catch { return ""; }
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (roleDuJeton(req) !== "service_role") return new Response(JSON.stringify({ error: "reserve au service" }), { status: 403, headers: { ...CORS, "Content-Type": "application/json" } });
  const { salon_id, questions } = await req.json();
  const [{ data: salon }, { data: cfgRows }] = await Promise.all([
    sb.from("salons").select("nom,metier,mode_activite,plan,status,is_free,stripe_connect_status,sms_mode,sms_credits,sms_monthly_free,taux_tva,forme_juridique,config_json").eq("id", salon_id).single(),
    sb.from("site_config").select("site_actif,reservation_active,boutique_active,acompte_obligatoire,acompte_montant,acompte_type,delai_min_heures,delai_max_jours,confirmation_auto,fidelite_active,fidelite_seuil,collaborateurs").eq("salon_id", salon_id).limit(1),
  ]);
  const base = await chargerBase();
  const fullSystem = BASE_PROMPT + "\n\n=== BASE DE CONNAISSANCES (source unique et vérifiée) ===\n" + base + "\n\n=== CONTEXTE ===\n" + buildContext(salon, cfgRows && cfgRows[0]);
  const out: any[] = [];
  for (const q of (questions || []).slice(0, 25)) {
    const msgs = Array.isArray(q) ? q.map((t: string, i: number) => ({ role: i % 2 === 0 ? "user" : "assistant", content: t })) : [{ role: "user", content: String(q) }];
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 500, system: fullSystem, messages: msgs }) });
    const d = await r.json().catch(() => ({}));
    out.push({ q, status: r.status, a: (d.content && d.content[0] && d.content[0].text) || JSON.stringify(d).slice(0, 300) });
  }
  return new Response(JSON.stringify({ kb_chars: base.length, answers: out }), { headers: { ...CORS, "Content-Type": "application/json" } });
});
