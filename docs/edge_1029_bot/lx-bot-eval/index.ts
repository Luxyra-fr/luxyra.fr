// lx-bot-eval v5 — 2026-10-29 : réaligné sur bot-reply v17 (même consigne BASE_PROMPT, même base, même contexte, même modèle
// avec repli, même règle Google Play PLAY_PROMPT + filtre filtrerPlay). Banc d'essai, AUCUNE écriture. Réservé au rôle service.
// Entrée : { salon_id, questions: [ "question" | ["q1","r1","q2"…] ], play?: boolean }.
// Sortie : { kb_chars, play, answers: [{ q, status, model, a (réponse finale, filtrée si play), brut, filtre_play }] }.
// (v3/v4 = ancienne consigne v12 + Haiku seul : docs/edge_1029_bot/avant/lx-bot-eval/index.ts)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SB_URL = Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL")!;
const SB_SR  = Deno.env.get("SB_SERVICE_ROLE") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(SB_URL, SB_SR, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
{ const _LX_FN="lx-bot-eval"; const _LX_URL=Deno.env.get("SB_URL")||Deno.env.get("SUPABASE_URL")||""; const _LX_SR=Deno.env.get("SB_SERVICE_ROLE")||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||""; const _lxReport=async(msg:string,sev:"warning"|"error"|"critical",err?:unknown,ctx?:Record<string,unknown>)=>{try{await fetch(_LX_URL+"/rest/v1/rpc/report_server_error",{method:"POST",headers:{"Content-Type":"application/json","apikey":_LX_SR,"Authorization":"Bearer "+_LX_SR},body:JSON.stringify({p_source:"edge_fn:"+_LX_FN,p_message:String(msg||"").slice(0,800),p_severity:sev,p_stack:(err as Error)?.stack?String((err as Error).stack).slice(0,3000):null,p_context:ctx||null})});}catch(_){}}; (globalThis as any).__lxReport=_lxReport; const _orig=Deno.serve; (Deno as any).serve=(handler:any,opts?:any)=>_orig(async(req:Request)=>{try{const res=await handler(req); if(res&&res.status>=500){const body=await res.clone().text().catch(()=>""); await _lxReport("HTTP "+res.status,"error",undefined,{url:req.url,body:body.slice(0,500)});} return res;}catch(e){const err=e as Error; await _lxReport("Exception non gérée: "+(err?.message||String(e)),"critical",err,{url:req.url}); return new Response(JSON.stringify({error:"Internal server error"}),{status:500,headers:{"Content-Type":"application/json"}});}}, opts); }

const BASE_PROMPT = `Tu es l'assistant support de Luxyra, logiciel de gestion pour établissements de beauté et de bien-être (coiffure, barbier, institut, onglerie, regard, maquillage, tatouage, spa…) en France. Tu aides les professionnels qui utilisent l'application : planning, encaissement, caisse, clients, prestations, produits, équipe, bons cadeaux, fidélité, SMS, site de réservation, boutique, abonnement.

Méthode :
1. Cherche TOUTES les fiches de la BASE DE CONNAISSANCES qui concernent la question (une même question peut être couverte par plusieurs fiches : rassemble-les).
2. Si la base répond, même en partie : réponds avec ce qu'elle dit, en donnant le chemin EXACT (libellés entre « », séparés par ›). Sois bref : 150 mots maximum (au plus 7 étapes numérotées pour une manipulation) ; va droit au but, sans répéter la question ni détailler ce qui n'est pas demandé. Vouvoiement, ton chaleureux et simple.
3. Si la base dit qu'une chose N'EXISTE PAS ou n'est pas possible : dis-le clairement et donne l'alternative indiquée par la base.
4. Si la question est ambiguë, réponds au cas le plus probable puis propose en une phrase l'autre cas couvert par la base.
5. Tiens compte du CONTEXTE de l'établissement (forfait, TVA, verrouillage, site actif…) : par exemple, si une fonction est réservée au forfait Pro et que l'établissement est en Essentiel, dis-le.
6. Quand un guide du centre d'aide correspond, tu peux terminer par « Guide détaillé : luxyra.fr/aide » (n'ajoute une adresse de page précise que si elle figure dans la base).
7. Ne commente pas l'état de l'abonnement (résilié, essai…) sauf si c'est la cause directe du problème posé.
8. Salutations et remerciements : une phrase, sans liste.

Passer la main à un humain — ta réponse ENTIÈRE est alors exactement <ESCALATE/> — seulement dans ces cas :
- La personne signale un bug, une donnée disparue ou qui ne reste pas enregistrée, un montant faux, un blocage, un message d'erreur, ou dit que ce que tu as indiqué ne marche pas / qu'elle ne le trouve pas.
- Question fiscale, comptable ou juridique (quel taux appliquer, obligations, déclarations), ou question sur la facturation / le prélèvement de son abonnement Luxyra, un remboursement, un geste commercial.
- Demande qui exige une action de l'équipe Luxyra (changer le nom, le SIRET ou le métier verrouillés, débloquer un compte, récupérer des données, migration).
- Aucune fiche de la base ne permet de répondre, même partiellement.
- La personne demande explicitement à parler à quelqu'un.

Règles absolues :
- N'invente jamais un menu, onglet, bouton, réglage, prix ou délai absent de la base. Si un détail manque, donne ce que la base contient et dis simplement que ce détail précis sera confirmé par l'équipe si besoin.
- N'invoque la loi, la NF525, l'administration fiscale ou la sécurité que si la base le dit pour ce point. Ne dis jamais « certifié NF525 ».
- Dis « établissement » et « client » (jamais « cliente »).
- Tu ES le support : ne renvoie jamais vers « Contacter le support » ou une adresse e-mail, sauf si la base le prévoit pour ce cas précis.
- Ne propose aucun contournement technique (vider le cache, réinstaller, changer de navigateur…).
- Mise en forme : texte simple, pas de titres ; étapes « 1. », « 2. »… une par ligne ; au plus quelques mots en **gras**.
- Réponds sans préfixe « 🤖 » ni « Assistant : ».`;

// 2026-10-29 — CONFORMITÉ GOOGLE PLAY (paiements) : message envoyé depuis l'appli Android « Luxyra Pro »
// (support_messages.play = true, posé par app.html quand lxPlay()). Le bot ne doit JAMAIS orienter vers un autre
// moyen de payer l'abonnement ou les SMS : consigne stricte + filtre de la réponse. Même texte dans lx-bot-eval.
const PLAY_PROMPT = `=== APPLICATION ANDROID « LUXYRA PRO » (GOOGLE PLAY) — RÈGLE STRICTE, PRIORITAIRE SUR TOUT LE RESTE ===
La personne écrit depuis l'application Android « Luxyra Pro » installée depuis Google Play. Dans toute cette conversation :
- Ne dis JAMAIS où, comment ni par quel moyen s'abonner, changer de forfait, payer ou gérer l'abonnement Luxyra, acheter ou recharger des SMS.
- Ne cite AUCUN prix de forfait ni de pack SMS, AUCUN site, adresse web, lien, navigateur, ordinateur ou autre appareil pour faire ces opérations, et aucun moyen de paiement.
- Si la question porte sur ces sujets (s'abonner, forfait, prix de l'abonnement, achat de SMS…), réponds seulement, en une phrase : « Cette opération n'est pas disponible dans l'application. » Rien de plus : pas d'alternative, pas de « depuis un ordinateur », pas de lien, même si la base de connaissances en indique un.
- Tu peux expliquer ce que contient un forfait (fonctions) sans prix ni moyen de souscrire. Pour tout le reste, réponds normalement.
- Les acomptes et paiements des clients de l'établissement (prestations) ne sont pas concernés.`;
const PLAY_REPONSE_NEUTRE = "Cette opération n'est pas disponible dans l'application.";
const PLAY_TOUJOURS: RegExp[] = [
  /luxyra\.fr\/app/i, /navigateur/i, /https?:\/\//i, /\bwww\./i, /stripe\.com/i, /lien\s+de\s+paiement/i,
  /\b(s['’]abonner|vous\s+abonner|abonnez-vous|souscrire|souscrivez)\s+(sur|depuis|via|à\s+partir|en\s+ligne|par)/i,
  /\b(14|24)[,.]99\b/, /luxyra\.fr\/(tarifs|inscription)/i,
];
const PLAY_LIEU = /(ordinateur|\bpc\b|\bmac\b|tablette|luxyra\.fr|chrome|safari|firefox|application\s+web|version\s+web|site\s+(internet\s+|web\s+)?(de\s+)?luxyra|autre\s+appareil)/i;
const PLAY_ACHAT = /(abonn|forfait|pack|cr[ée]dits?\s+sms|achat|achet|recharg|souscri|tarif|prix|payer)/i;
function playPhraseInterdite(s: string): boolean {
  if (PLAY_TOUJOURS.some((re) => re.test(s))) return true;
  return PLAY_LIEU.test(s) && PLAY_ACHAT.test(s);
}
function filtrerPlay(texte: string): { texte: string; retirees: number } {
  let retirees = 0;
  const lignes = String(texte || "").split("\n").map((ligne) => {
    const phrases = ligne.split(/(?<=[.!?…])\s+/);
    const gardees = phrases.filter((p) => { const bad = playPhraseInterdite(p); if (bad) retirees++; return !bad; });
    const l = gardees.join(" ");
    if (gardees.length !== phrases.length && /^\s*(\d+[.)]|[-•*])?\s*(\*\*)?\s*$/.test(l)) return null;
    return l;
  }).filter((l) => l !== null) as string[];
  let out = lignes.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!out || !/[a-zà-ÿ]{3,}/i.test(out.replace(/<ESCALATE\/>/g, ""))) out = out.includes("<ESCALATE/>") ? out : PLAY_REPONSE_NEUTRE;
  return { texte: out, retirees };
}


const KB_SECOURS = `Menu Paramètres (⚙️ sur l'accueil) : Établissement ; Horaires ; Équipe ; Affichage planning ; Apparence ; Infos établissement ; Site en ligne ; Options commerciales ; Caisse et paiements ; Paiements en ligne ; SMS et Marketing ; NF525 ; Mes factures ; Mes documents ; Notifications push ; Migration depuis ancien logiciel ; Support Luxyra. Il n'existe pas de rubrique « Sécurité ».`;
async function chargerBase(): Promise<string> {
  try {
    const { data, error } = await sb.from("support_bot_kb").select("titre,contenu,ordre").eq("actif", true).order("ordre", { ascending: true });
    if (error || !data || !data.length) { await (globalThis as any).__lxReport?.("bot-reply : base de connaissances illisible, secours utilise : "+(error?.message||"vide"), "warning"); return KB_SECOURS; }
    return data.map((r: any) => "### " + r.titre + "\n" + r.contenu).join("\n\n");
  } catch (e) { return KB_SECOURS; }
}

function buildContext(salon: any, cfg: any, play = false): string {
  if (!salon) return "CONTEXTE : salon inconnu.";
  const lines: string[] = [];
  lines.push(`CONTEXTE du salon qui pose la question :`);
  lines.push(`- Nom : ${salon.nom || "—"}`);
  lines.push(`- Métier : ${salon.metier || "non renseigné"}`);
  lines.push(`- Mode activité : ${salon.mode_activite || "salon fixe"}`);
  lines.push(`- Forfait actuel : ${salon.plan === "pro" ? (play ? "Pro" : "Pro (24,99€)") : salon.plan === "essential" ? (play ? "Essentiel" : "Essentiel (14,99€)") : salon.plan || "inconnu"}`);
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

const MODELE_PRINCIPAL = Deno.env.get("BOT_MODEL") || "claude-sonnet-5-5";
const MODELE_SECOURS = "claude-haiku-4-5-20251001";
function roleDuJeton(req: Request): string {
  try { const t=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,""); const p=t.split(".")[1]; const j=JSON.parse(atob(p.replace(/-/g,"+").replace(/_/g,"/"))); return String(j.role||""); } catch { return ""; }
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (roleDuJeton(req) !== "service_role") return new Response(JSON.stringify({ error: "reserve au service" }), { status: 403, headers: { ...CORS, "Content-Type": "application/json" } });
  const { salon_id, questions, play: playIn } = await req.json();
  const play = playIn === true;
  const [{ data: salon }, { data: cfgRows }] = await Promise.all([
    sb.from("salons").select("nom,metier,mode_activite,plan,status,is_free,stripe_connect_status,sms_mode,sms_credits,sms_monthly_free,taux_tva,forme_juridique,config_json").eq("id", salon_id).single(),
    sb.from("site_config").select("site_actif,reservation_active,boutique_active,acompte_obligatoire,acompte_montant,acompte_type,delai_min_heures,delai_max_jours,confirmation_auto,fidelite_active,fidelite_seuil,collaborateurs,horaires_salon,absences").eq("salon_id", salon_id).limit(1),
  ]);
  const base = await chargerBase();
  const systemBlocks: any[] = [
    { type: "text", text: BASE_PROMPT + "\n\n=== BASE DE CONNAISSANCES (source unique et vérifiée) ===\n" + base, cache_control: { type: "ephemeral" } },
    { type: "text", text: "=== CONTEXTE ===\n" + buildContext(salon, cfgRows && cfgRows[0], play) },
  ];
  if (play) systemBlocks.push({ type: "text", text: PLAY_PROMPT });
  const out: any[] = [];
  for (const q of (questions || []).slice(0, 25)) {
    const messages = Array.isArray(q) ? q.map((t: string, i: number) => ({ role: i % 2 === 0 ? "user" : "assistant", content: t })) : [{ role: "user", content: String(q) }];
    const appel = (model: string) => fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model, max_tokens: 1600, system: systemBlocks, messages }) });
    let model = MODELE_PRINCIPAL;
    let r = await appel(model);
    if (!r.ok) { if (r.status === 429 || r.status >= 500) await new Promise((res) => setTimeout(res, 1500)); model = MODELE_SECOURS; r = await appel(model); }
    const d = await r.json().catch(() => ({}));
    const brut = Array.isArray(d.content) ? d.content.filter((c: any) => c && c.type === "text").map((c: any) => c.text).join("") : "";
    const f = play ? filtrerPlay(brut) : { texte: brut, retirees: 0 };
    out.push({ q, status: r.status, model, a: brut ? f.texte.trim() : JSON.stringify(d).slice(0, 300), brut: play ? brut : undefined, filtre_play: f.retirees });
  }
  return new Response(JSON.stringify({ kb_chars: base.length, play, answers: out }), { headers: { ...CORS, "Content-Type": "application/json" } });
});
