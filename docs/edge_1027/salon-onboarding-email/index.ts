// salon-onboarding-email v10 — 2026-10-27 : contenus J0→J14 réécrits (ton professionnel, étapes précises avec les vrais noms de menus,
// astuce, guide d'aide, signature), prénom lu dans salons.gerant_prenom (repli config_json), version texte jointe.
// v9 — SECURITE 2026-10-08 : jour 0 sans secret = uniquement salon cree il y a < 2 h et jamais envoye (plus de force), pas d'email dans la reponse, appel worker authentifie
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// 2026-10-10 : mise en page commune des emails Luxyra (identique au worker docs/luxyra-router-worker.js → lxMailLayout)
// opts.salon : si renseigné, email envoyé AU NOM d'un établissement à sa cliente (pied de page : « envoyé pour le compte de … via Luxyra »)
function lxMailLayout(corpsHtml: string, opts: { titre?: string; pied?: string; salon?: string; idSuivi?: string } = {}): string {
  const titre = opts.titre ? `<h1 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:400;color:#1a1a1a;line-height:1.3">${opts.titre}</h1>` : "";
  const pixel = opts.idSuivi ? `<img src="https://luxyra.fr/api/e/o/${opts.idSuivi}.gif" width="1" height="1" alt="" style="display:block;border:0">` : "";
  const pied = opts.pied ? `<div style="margin-bottom:6px">${opts.pied}</div>` : "";
  const sousTitre = opts.salon ? opts.salon : "GESTION &amp; CAISSE POUR LES PROFESSIONNELS DE LA BEAUTÉ ET DU BIEN-ÊTRE";
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
const CRON_SECRET = Deno.env.get("AVIS_CRON_SECRET") || "";
const sb = createClient(SB_URL, SB_SR, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s:number,b:unknown){return new Response(JSON.stringify(b),{status:s,headers:{...CORS,"Content-Type":"application/json"}});}
function esc(s:unknown){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
{ const _LX_FN="salon-onboarding-email"; const _LX_URL=Deno.env.get("SB_URL")||Deno.env.get("SUPABASE_URL")||""; const _LX_SR=Deno.env.get("SB_SERVICE_ROLE")||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||""; const _lxReport=async(msg:string,sev:"warning"|"error"|"critical",err?:unknown,ctx?:Record<string,unknown>)=>{try{await fetch(_LX_URL+"/rest/v1/rpc/report_server_error",{method:"POST",headers:{"Content-Type":"application/json","apikey":_LX_SR,"Authorization":"Bearer "+_LX_SR},body:JSON.stringify({p_source:"edge_fn:"+_LX_FN,p_message:String(msg||"").slice(0,800),p_severity:sev,p_stack:(err as Error)?.stack?String((err as Error).stack).slice(0,3000):null,p_context:ctx||null})});}catch(_){}}; (globalThis as any).__lxReport=_lxReport; const _orig=Deno.serve; (Deno as any).serve=(handler:any,opts?:any)=>_orig(async(req:Request)=>{try{const res=await handler(req); if(res&&res.status>=500){const body=await res.clone().text().catch(()=>""); await _lxReport("HTTP "+res.status,"error",undefined,{url:req.url,body:body.slice(0,500)});} return res;}catch(e){const err=e as Error; await _lxReport("Exception non gérée: "+(err?.message||String(e)),"critical",err,{url:req.url}); return new Response(JSON.stringify({error:"Internal server error"}),{status:500,headers:{"Content-Type":"application/json"}});}}, opts); }
interface SalonCtx { nom: string; prenom: string; email: string; slug: string; plan: string; metier: string; mode: string; }
const APP_URL = "https://luxyra.fr/app.html";
const SUPPORT_EMAIL = "support@luxyra.fr";
let CFG: any = null;
async function getConfig() { if (CFG) return CFG; try { const { data } = await sb.from("app_config").select("config").eq("id", 1).maybeSingle(); CFG = (data && data.config) || {}; } catch { CFG = {}; } return CFG; }
function fmt(n:number, d=2) { return Number(n).toFixed(d).replace(".", ","); }
async function stripeFeeLabel() { const c = await getConfig(); return fmt(c.stripe_fee_pct ?? 1.5, 1) + "% + " + fmt(c.stripe_fee_fixed ?? 0.25) + " €"; }
async function smsBonus() { const c = await getConfig(); return Number(c.sms_bonus_first_pay ?? 150); }
async function smsPriceLabel() { const c = await getConfig(); return fmt(c.sms_price_ttc ?? 0.065, 3) + " €"; }
// ==== DEBUT GABARITS v10 ====
const OR = "#9a7b2c";
// Conseils adaptés au métier principal choisi à l'inscription (salons.metier). Inconnu → textes génériques.
const METIER: Record<string, { duree: string; forfait: string; fidelite: string }> = {
  coiffure:   { duree: "Une coloration annoncée 1 h qui en prend 1 h 30, temps de pose compris, décale toute votre journée.", forfait: "par exemple 5 brushings", fidelite: "« la 10e visite à -20 % »" },
  barbier:    { duree: "Une taille de barbe annoncée 20 min qui en prend 35 décale tous les rendez-vous suivants.", forfait: "par exemple 5 tailles de barbe", fidelite: "« la 10e coupe offerte à -50 % »" },
  esthetique: { duree: "Un soin du visage annoncé 45 min qui en prend 1 h, installation comprise, décale toute votre journée.", forfait: "par exemple une cure de 6 soins", fidelite: "« le 10e soin à -20 % »" },
  ongles:     { duree: "Une pose de gel annoncée 1 h qui en prend 1 h 30, séchage compris, décale toute votre journée.", forfait: "par exemple 5 remplissages", fidelite: "« le 10e rendez-vous à -20 % »" },
  regard:     { duree: "Une pose de cils annoncée 1 h 30 qui en prend 2 h décale toute votre journée.", forfait: "par exemple 4 remplissages de cils", fidelite: "« le 8e remplissage à -20 % »" },
  maquillage: { duree: "Un maquillage annoncé 45 min qui en prend 1 h 15, préparation de peau comprise, décale toute votre journée.", forfait: "par exemple un forfait mariée essai + jour J", fidelite: "« -15 % dès la 5e prestation »" },
  tatouage:   { duree: "Une séance annoncée 2 h qui en prend 3, préparation et soins compris, bloque votre agenda bien au-delà du prévu.", forfait: "par exemple les séances d'un même projet", fidelite: "« -10 % sur le prochain projet »" },
  spa:        { duree: "Un massage d'1 h demande souvent 1 h 15 avec l'accueil et l'installation : sans ce temps, toute la journée glisse.", forfait: "par exemple une carte de 5 massages", fidelite: "« le 10e soin à -20 % »" },
  bien_etre:  { duree: "Une séance d'1 h demande souvent 1 h 15 avec l'accueil et l'installation : sans ce temps, toute la journée glisse.", forfait: "par exemple une carte de 10 séances", fidelite: "« la 10e séance à -20 % »" },
};
const METIER_DEF = { duree: "Une prestation annoncée 1 h qui en prend 1 h 30 décale toute votre journée.", forfait: "par exemple une carte de 5 séances", fidelite: "« la 10e visite à -20 % »" };
function mt(ctx: SalonCtx) { return METIER[ctx.metier] || METIER_DEF; }
const AIDE = "https://luxyra.fr/aide/";
function wrap(title: string, body: string) { return lxMailLayout(body, { titre: title, pied: `Vous recevez cet e-mail car vous avez créé un compte professionnel Luxyra. Ces conseils de démarrage s'arrêtent d'eux-mêmes après 14 jours.` }); }
function btn(href: string, label: string) { return lxMailBouton(esc(label), esc(href)); }
function pp(text: string) { return `<p style="font-size:15px;line-height:1.7;color:#333333;margin:0 0 14px">${text}</p>`; }
function bonjour(ctx: SalonCtx) { return pp(ctx.prenom ? `Bonjour ${esc(ctx.prenom)},` : `Bonjour,`); }
function sujet(ctx: SalonCtx, texte: string) { return ctx.prenom ? `${ctx.prenom}, ${texte}` : texte.charAt(0).toUpperCase() + texte.slice(1); }
function etiquette(texte: string) { return `<div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:${OR};font-weight:700;margin:0 0 6px">${texte}</div>`; }
function chemin(t: string) { return `<span style="display:inline-block;background:#f4f1ea;border:1px solid #e6dcc3;border-radius:6px;padding:1px 7px;font-size:13px;color:#1a1a1a;white-space:nowrap">${t}</span>`; }
function box(title: string, content: string) { return `<div style="background:#faf6ec;border:1px solid #e6dcc3;border-radius:12px;padding:18px;margin:18px 0"><div style="font-weight:800;color:${OR};margin-bottom:8px;font-size:14px">${title}</div><div style="font-size:14px;line-height:1.7;color:#333333">${content}</div></div>`; }
function etapes(titre: string, liste: { t: string; d: string }[]) {
  const lignes = liste.map((e, i) => `<tr><td style="vertical-align:top;padding:0 14px 16px 0;width:30px"><div style="width:28px;height:28px;line-height:28px;border-radius:50%;background:#0b0b0b;color:#d4a843;text-align:center;font-weight:700;font-size:13px;font-family:Georgia,serif">${i + 1}</div></td><td style="vertical-align:top;padding:0 0 16px"><div style="font-weight:700;color:#1a1a1a;font-size:15px;margin-bottom:3px">${e.t}</div><div style="font-size:14px;line-height:1.65;color:#444444">${e.d}</div></td></tr>`).join("");
  return `<div style="margin:22px 0 6px">${titre ? `<div style="font-family:Georgia,'Times New Roman',serif;font-size:18px;color:#1a1a1a;margin-bottom:14px">${titre}</div>` : ""}<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse">${lignes}</table></div>`;
}
function astuce(texte: string) { return `<div style="border-left:3px solid #c8a84e;background:#fffdf7;padding:12px 16px;margin:18px 0;font-size:14px;line-height:1.65;color:#444444"><strong style="color:${OR}">Le conseil du jour</strong><br>${texte}</div>`; }
function guides(liste: { url: string; t: string }[]) { return `<div style="margin:18px 0;font-size:14px;color:#444444"><strong>Guides pas à pas, avec captures :</strong><br>${liste.map(g => `→ <a href="${AIDE}${g.url}" style="color:#b8922e">${g.t}</a>`).join("<br>")}</div>`; }
function signature() { return `<div style="margin:26px 0 6px;padding-top:18px;border-top:1px solid #f0ebe0">${pp(`Une question, un blocage ? Répondez simplement à cet e-mail, ou écrivez à <a href="mailto:${SUPPORT_EMAIL}" style="color:#b8922e">${SUPPORT_EMAIL}</a>. Vous pouvez aussi passer par ${chemin("Paramètres › Support Luxyra")} dans l'application. Une vraie personne vous répond.`)}<p style="font-size:15px;line-height:1.5;color:#333333;margin:14px 0 0">À très vite,<br><strong>Alexandre Jensen</strong><br><span style="color:#8a8a8a;font-size:13px">Fondateur de Luxyra</span></p></div>`; }
function versionTexte(html: string) {
  return html.replace(/(<\/div>)?<\/td><td[^>]*>/gi, ". ").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|h1)>/gi, "\n").replace(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/gi, "$2 ($1)").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
}
const INSTALLER = `<strong>iPhone / iPad</strong> (Safari) : bouton Partager <strong>⬆</strong> › « Sur l'écran d'accueil ».<br><strong>Android</strong> (Chrome) : menu <strong>⋮</strong> › « Installer l'application ».<br><strong>Ordinateur</strong> (Chrome ou Edge) : icône d'installation à droite de la barre d'adresse › « Installer ».<br>Dans Luxyra, ${chemin("Paramètres › Installer l'application")} vous guide aussi.`;

async function emailJ0(ctx: SalonCtx) {
  const salonUrl = ctx.slug ? `https://luxyra.fr/${ctx.slug}` : "";
  const isPro = ctx.plan === "pro";
  const subject = sujet(ctx, `bienvenue sur Luxyra : ${ctx.nom} est prêt`);
  const body = `${bonjour(ctx)}
${pp(`Merci d'avoir choisi Luxyra. Le compte de <strong>${esc(ctx.nom)}</strong> est créé et votre <strong>essai gratuit de 14 jours</strong> commence aujourd'hui, sans engagement et sans carte bancaire.`)}
${pp(`Planning, encaissement, fichier clients, réservation en ligne, statistiques : tout est réuni au même endroit, sur ordinateur, tablette et téléphone.`)}
${box("Vos accès", `<strong>Application :</strong> <a href="${APP_URL}" style="color:#b8922e">luxyra.fr/app.html</a><br><strong>Identifiant :</strong> ${esc(ctx.email)}${salonUrl ? `<br><strong>Votre page de réservation :</strong> <a href="${salonUrl}" style="color:#b8922e">luxyra.fr/${esc(ctx.slug)}</a>` : ""}`)}
${btn(APP_URL, "Ouvrir mon espace Luxyra")}
${etapes("Bien démarrer en 20 minutes", [
  { t: "Vos prestations", d: `Tuile ${chemin("Services et Forfaits")} : nom, durée, prix. C'est la base du planning et de la caisse.` },
  { t: "Vos horaires d'ouverture", d: `${chemin("Paramètres › Horaires")} : jours, heures, pauses. La réservation en ligne s'y adapte toute seule.` },
  { t: "Votre équipe", d: `${chemin("Paramètres › Équipe")} : ajoutez vos collaborateurs, leurs horaires et leurs accès. Seul(e) ? Vérifiez simplement votre propre fiche.` },
  { t: "Votre page en ligne", d: `${chemin("Paramètres › Site en ligne")} : vérifiez votre page, puis copiez son adresse pour vos réseaux sociaux.${isPro ? "" : " (Fonction du forfait Pro, ouverte pendant votre essai.)"}` },
])}
${box("Bon à savoir pendant l'essai", `Toutes les fonctions sont ouvertes, y compris celles du forfait Pro ; seul l'envoi de SMS s'active au premier paiement Pro. La caisse fonctionne en <strong>mode test</strong> (bandeau violet « MODE TEST ») : vous pouvez tout essayer, les tickets n'ont pas de valeur fiscale. Le jour où vous décidez de continuer, vous passez en caisse réelle puis vous vous abonnez depuis les Paramètres.`)}
${box("Installez Luxyra comme une application", INSTALLER)}
${pp(`Dans les jours qui viennent, je vous enverrai quelques e-mails courts pour vous aider, étape par étape : prestations et horaires, premiers encaissements, fidélité, puis un point après deux semaines.`)}
${guides([{ url: "premiers-pas.html", t: "Premiers pas dans Luxyra" }, { url: "configurer-mon-etablissement.html", t: "Configurer mon établissement" }])}
${signature()}`;
  return { subject, html: wrap(`Bienvenue chez Luxyra`, body) };
}

function emailJ1(ctx: SalonCtx) {
  const subject = sujet(ctx, `prestations, horaires, équipe : posez les bases (10 min)`);
  const body = `${etiquette("Votre démarrage · Jour 1")}${bonjour(ctx)}
${pp(`Un planning bien réglé dès le départ, c'est moins de corrections ensuite et des créneaux toujours justes, au planning comme en ligne. Voici les trois réglages à faire en premier.`)}
${etapes("", [
  { t: "Créez vos prestations", d: `Tuile ${chemin("Services et Forfaits")}. Pour chaque prestation : le nom, la <strong>durée réelle</strong>, le prix et les collaborateurs qui la réalisent. Vous pouvez les regrouper par catégorie.` },
  { t: "Réglez vos horaires", d: `${chemin("Paramètres › Horaires")} : vos jours et heures d'ouverture, vos pauses. Pour des congés ou un jour férié, utilisez « Fermeture exceptionnelle ».` },
  { t: "Complétez votre équipe", d: `${chemin("Paramètres › Équipe")} : dépliez la fiche de chaque collaborateur pour régler ses horaires, ses absences et ses permissions (accès à la caisse, au chiffre d'affaires…).` },
])}
${astuce(`Indiquez la durée réelle de chaque prestation. ${mt(ctx).duree}`)}
${btn(APP_URL, "Configurer mon établissement")}
${guides([{ url: "prestations-et-forfaits.html", t: "Prestations et forfaits" }, { url: "equipe-comptes-permissions.html", t: "Équipe, comptes et permissions" }])}
${signature()}`;
  return { subject, html: wrap("Les fondations de votre planning", body) };
}

async function emailJ3(ctx: SalonCtx) {
  const SMS_BONUS = await smsBonus(); const STRIPE_LBL = await stripeFeeLabel(); const isPro = ctx.plan === "pro";
  if (isPro) {
    const subject = sujet(ctx, `protégez votre agenda des rendez-vous non honorés`);
    const body = `${etiquette("Votre démarrage · Jour 3")}${bonjour(ctx)}
${pp(`Un rendez-vous non honoré, c'est un créneau perdu que personne n'a pu réserver. Avec votre forfait Pro, vos clients peuvent régler un acompte au moment où ils réservent en ligne : ils viennent, ou le créneau est couvert.`)}
${etapes("Mettre en place l'acompte en ligne", [
  { t: "Activez les paiements en ligne", d: `${chemin("Paramètres › Paiements en ligne")} : créez votre compte Stripe (quelques minutes, avec votre IBAN et une pièce d'identité). L'argent arrive directement sur votre compte bancaire.` },
  { t: "Choisissez votre garantie", d: `${chemin("Paramètres › Site en ligne")} : rubrique « Garantie anti-absence ». Aucune, acompte (montant ou pourcentage) ou empreinte bancaire.` },
  { t: "C'est automatique", d: `Le client paie en réservant. Le jour du rendez-vous, l'acompte est déduit tout seul au moment de l'encaissement.` },
])}
${box("Ce que ça coûte", `Frais Stripe : <strong>${STRIPE_LBL}</strong> par paiement, rien d'autre. Et au premier paiement de votre abonnement Pro, <strong>${SMS_BONUS} SMS vous sont offerts</strong> pour les rappels de rendez-vous.`)}
${astuce(`Un acompte modeste suffit souvent : l'important est que le client s'engage. Vous gardez la main sur le remboursement au cas par cas.`)}
${btn(APP_URL, "Activer l'acompte en ligne")}
${guides([{ url: "paiements-en-ligne.html", t: "Paiements en ligne (acomptes, empreintes, boutique)" }, { url: "site-et-reservation-en-ligne.html", t: "Site et réservation en ligne" }])}
${signature()}`;
    return { subject, html: wrap("Fini les rendez-vous non honorés", body) };
  }
  const subject = sujet(ctx, `votre caisse en pratique : encaisser et clôturer`);
  const body = `${etiquette("Votre démarrage · Jour 3")}${bonjour(ctx)}
${pp(`Votre caisse Luxyra est conforme à la loi anti-fraude à la TVA : chaque ticket est enregistré et sécurisé. Pendant l'essai, elle est en mode test : c'est le bon moment pour vous entraîner sans risque.`)}
${etapes("Un encaissement, de A à Z", [
  { t: "Ouvrez l'encaissement", d: `Tuile ${chemin("Encaissement")}, ou directement depuis le rendez-vous dans le ${chemin("Planning")}.` },
  { t: "Client et prestations", d: `Choisissez le client, ajoutez les prestations et les produits vendus. Remise, bon cadeau ou forfait se déduisent au même endroit.` },
  { t: "Paiement et ticket", d: `Sélectionnez le mode de paiement (carte, espèces, plusieurs moyens…), validez : le ticket est créé, à imprimer ou à envoyer par e-mail.` },
  { t: "Clôture du soir", d: `Après le dernier client, sur l'accueil, touchez « CLÔTURE DE LA JOURNÉE » sous le bandeau « CA DU JOUR » et comptez votre tiroir. Oubli ? La journée se clôture seule dans la nuit.` },
])}
${astuce(`Une erreur sur un ticket ? Rien ne se supprime : passez par ${chemin("Caisse › Gestion des tickets")} pour corriger le règlement ou faire un avoir. Tout reste tracé, comme l'exige la loi.`)}
${btn(APP_URL, "Faire un encaissement d'essai")}
${guides([{ url: "encaisser.html", t: "Encaisser" }, { url: "cloture-du-jour.html", t: "La clôture du jour" }, { url: "tickets-et-annulations.html", t: "Tickets et annulations" }])}
${signature()}`;
  return { subject, html: wrap("Votre caisse en pratique", body) };
}

function emailJ5(ctx: SalonCtx) {
  const isPro = ctx.plan === "pro";
  const subject = sujet(ctx, `faites revenir vos clients plus souvent`);
  const body = `${etiquette("Votre démarrage · Jour 5")}${bonjour(ctx)}
${pp(`Un client fidèle revient plus souvent et en parle autour de lui. Luxyra vous donne trois outils simples pour le récompenser, sans carte en carton ni tableau à tenir.`)}
${etapes("", [
  { t: "Le programme de fidélité", d: `${chemin("Paramètres › Options commerciales")} › « Programme de fidélité » : activez « Fidélité active » et choisissez la mécanique (visites ou montant dépensé). Luxyra compte tout seul et vous propose la remise en caisse le moment venu.` },
  { t: "Les forfaits", d: `Dans ${chemin("Services et Forfaits")}, créez des forfaits de plusieurs séances payées d'avance (${mt(ctx).forfait}). Le client est engagé, votre trésorerie aussi.${isPro ? " Votre forfait Pro permet aussi de vendre des cartes d'abonnement." : ""}` },
  { t: "Les bons cadeaux", d: `Tuile ${chemin("Bons cadeaux")} : vendez-les en caisse${isPro ? ", et même en ligne sur votre page" : ""}. Idéal pour les fêtes et les anniversaires.` },
])}
${astuce(`Restez simple : par exemple ${mt(ctx).fidelite}. Une règle que le client comprend en une phrase est une règle qui fonctionne. La phrase de résumé sous les réglages vous montre exactement ce qu'il verra.`)}
${btn(APP_URL, "Mettre en place ma fidélité")}
${guides([{ url: "fidelite-et-bons-cadeaux.html", t: "Fidélité, cartes d'abonnement et bons cadeaux" }])}
${signature()}`;
  return { subject, html: wrap("Fidélisez vos clients", body) };
}

async function emailJ7(ctx: SalonCtx) {
  const SMS_BONUS = await smsBonus(); const SMS_PRICE = await smsPriceLabel(); const isPro = ctx.plan === "pro";
  if (isPro) {
    const subject = sujet(ctx, `rappels automatiques et campagnes SMS`);
    const body = `${etiquette("Votre démarrage · Jour 7")}${bonjour(ctx)}
${pp(`Une semaine déjà. Parlons de ce qui fait gagner le plus de temps au quotidien : les SMS. Moins d'oublis, moins d'appels pour confirmer, et des clients qui reviennent quand vous les relancez.`)}
${etapes("", [
  { t: "Les rappels automatiques", d: `${chemin("Paramètres › SMS et Marketing")} : rappel 24 h avant chaque rendez-vous (et 2 h avant si vous le souhaitez). Le texte est modifiable, avec le prénom, l'heure et le nom de votre établissement.` },
  { t: "Votre nom d'expéditeur", d: `Tuile ${chemin("Marketing")} › onglet « Configuration » : vos clients voient le nom de votre établissement, pas un numéro inconnu.` },
  { t: "Les campagnes", d: `Tuile ${chemin("Marketing")} : un message pour une nouveauté, une place libérée, un anniversaire, ou pour relancer les clients que vous n'avez pas vus depuis longtemps.` },
])}
${box("Quand et combien", `Les SMS s'activent au <strong>premier paiement de votre forfait Pro</strong>, avec <strong>${SMS_BONUS} SMS offerts</strong>. Ensuite : <strong>${SMS_PRICE} TTC</strong> par SMS, sans abonnement. D'ici là, vous pouvez déjà préparer vos textes et vos réglages.`)}
${astuce(`Commencez par les rappels automatiques : c'est le réglage qui réduit le plus les oublis, et il ne demande plus rien une fois activé.`)}
${btn(APP_URL, "Activer mes rappels")}
${guides([{ url: "sms-et-rappels.html", t: "SMS, rappels et campagnes" }])}
${signature()}`;
    return { subject, html: wrap("Vos SMS travaillent pour vous", body) };
  }
  const subject = sujet(ctx, `une semaine avec Luxyra : vos chiffres et vos réflexes`);
  const body = `${etiquette("Votre démarrage · Jour 7")}${bonjour(ctx)}
${pp(`Une semaine déjà. Voici les trois réflexes qui vous feront gagner du temps chaque semaine, et vous donneront une vision claire de votre activité.`)}
${etapes("", [
  { t: "Suivre votre activité", d: `Tuile ${chemin("Statistiques")} : chiffre d'affaires, panier moyen, prestations les plus demandées, activité de chaque collaborateur.` },
  { t: "Clôturer chaque soir", d: `Sur l'accueil, « CLÔTURE DE LA JOURNÉE ». Le rapport Z est créé et conservé pour vous, prêt en cas de contrôle.` },
  { t: "Préparer la comptabilité", d: `${chemin("Caisse › Journal / Bande Z")} › « Documents comptables » : exports prêts à transmettre à votre comptable.` },
])}
${box("Envie d'aller plus loin ?", `Le forfait <strong>Pro</strong> ajoute l'acompte en ligne contre les rendez-vous non honorés, les rappels et campagnes SMS (${SMS_BONUS} SMS offerts au premier paiement) et les cartes d'abonnement. Pour comparer : <a href="https://luxyra.fr/tarifs" style="color:#b8922e">luxyra.fr/tarifs</a>.`)}
${btn(APP_URL, "Voir mes statistiques")}
${guides([{ url: "statistiques.html", t: "Statistiques" }, { url: "comptabilite-et-exports.html", t: "Comptabilité et exports" }])}
${signature()}`;
  return { subject, html: wrap("Le point après une semaine", body) };
}

async function emailJ14(ctx: SalonCtx) {
  let nbRdv = 0;
  try { const { data: salon } = await sb.from("salons").select("id").eq("slug", ctx.slug).maybeSingle(); if (salon) { const since = new Date(); since.setDate(since.getDate() - 14); const { count } = await sb.from("rdv_online").select("*", { count: "exact", head: true }).eq("salon_id", salon.id).gte("created_at", since.toISOString()); nbRdv = count || 0; } } catch {}
  const salonUrl = ctx.slug ? `https://luxyra.fr/${ctx.slug}` : "";
  const subject = nbRdv > 0 ? sujet(ctx, `${nbRdv} rendez-vous pris en ligne en 2 semaines`) : sujet(ctx, `2 semaines sur Luxyra : faites connaître votre page`);
  const intro = nbRdv > 0
    ? pp(`Deux semaines déjà, et <strong>${nbRdv} rendez-vous</strong> ont été pris en ligne chez ${esc(ctx.nom)}. Autant de coups de téléphone en moins. Voici comment en recevoir encore davantage.`)
    : pp(`Deux semaines déjà. Votre page de réservation est prête, mais elle n'a pas encore reçu de rendez-vous. Le plus souvent, c'est simplement que vos clients ne la connaissent pas encore. Voici comment la faire connaître en quelques minutes.`);
  const body = `${etiquette("Votre démarrage · Jour 14")}${bonjour(ctx)}
${intro}
${salonUrl ? box("Votre page de réservation", `<a href="${salonUrl}" style="color:#b8922e;font-size:15px;font-weight:700">luxyra.fr/${esc(ctx.slug)}</a><br>Une adresse plus courte ? ${chemin("Paramètres › Site en ligne")} › « Personnaliser votre adresse ».`) : ""}
${etapes("Faire connaître votre page", [
  { t: "Vos réseaux sociaux", d: `Ajoutez l'adresse dans votre bio Instagram, Facebook et TikTok, et dans votre signature e-mail.` },
  { t: "Google", d: `Ajoutez le bouton « Réserver » sur votre fiche Google : le guide pas à pas est dans l'application et dans le centre d'aide.` },
  ctx.mode === "domicile"
    ? { t: "Chez vos clients", d: `Une carte avec votre QR code laissée après chaque passage, et le réflexe de dire « la prochaine fois, réservez en ligne » en fin de rendez-vous.` }
    : { t: "Votre établissement", d: `Un QR code en vitrine ou à l'accueil, et le réflexe de dire « vous pouvez aussi réserver en ligne » en fin de rendez-vous.` },
])}
${ctx.plan === "pro" ? "" : box("Bon à savoir", `La page en ligne et la réservation en ligne font partie du forfait <strong>Pro</strong>. Elles sont ouvertes pendant votre essai et restent actives si vous choisissez le Pro. Comparer les forfaits : <a href="https://luxyra.fr/tarifs" style="color:#b8922e">luxyra.fr/tarifs</a>.`)}
${box("Votre essai se termine bientôt", `Pour continuer sans interruption : passez votre caisse en mode réel, puis touchez « S'abonner » dans les Paramètres. Vos prestations, clients et rendez-vous sont conservés tels quels.`)}
${btn(APP_URL, "Ouvrir Luxyra")}
${guides([{ url: "site-et-reservation-en-ligne.html", t: "Site et réservation en ligne (et bouton Google)" }, { url: "rendez-vous-en-ligne.html", t: "Les rendez-vous en ligne" }])}
${pp(`Et si quelque chose vous freine, dites-le-moi en répondant à cet e-mail : je lis chaque réponse.`)}
${signature()}`;
  return { subject, html: wrap(nbRdv > 0 ? "Deux semaines, déjà des résultats" : "Deux semaines sur Luxyra", body) };
}
// ==== FIN GABARITS v10 ====
async function buildEmail(day: number, ctx: SalonCtx) { if (day === 0) return await emailJ0(ctx); if (day === 1) return emailJ1(ctx); if (day === 3) return await emailJ3(ctx); if (day === 5) return emailJ5(ctx); if (day === 7) return await emailJ7(ctx); if (day === 14) return await emailJ14(ctx); return null; }
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  try {
    const body = await req.json().catch(() => null);
    if (!body) return json(400, { error: "Body JSON requis" });
    const salon_id = String(body.salon_id || "");
    const day = Math.round(Number(body.day));
    const provided = req.headers.get("x-cron-secret") || "";
    const avecSecret = !!CRON_SECRET && provided === CRON_SECRET;
    const force = avecSecret && !!body.force;
    if (!salon_id) return json(400, { error: "salon_id requis" });
    if (![0, 1, 3, 5, 7, 14].includes(day)) return json(400, { error: "day doit être 0, 1, 3, 5, 7 ou 14" });
    if (day !== 0 && !avecSecret) return json(401, { error: "Unauthorized" });
    const { data: salon, error: sErr } = await sb.from("salons").select("id, nom, email, slug, plan, metier, mode_activite, gerant_prenom, onboarding_emails_sent, created_at").eq("id", salon_id).maybeSingle();
    if (sErr) return json(500, { error: "Erreur interne" });
    if (!salon) return json(404, { error: "Salon introuvable" });
    // Jour 0 sans secret (appel depuis l'inscription) : seulement pour un salon tout juste cree.
    if (day === 0 && !avecSecret) { const ageMs = Date.now() - new Date(salon.created_at || 0).getTime(); if (!(ageMs >= 0 && ageMs < 2 * 3600 * 1000)) return json(403, { error: "Forbidden" }); }
    const sentArr: number[] = Array.isArray(salon.onboarding_emails_sent) ? salon.onboarding_emails_sent as number[] : [];
    if (!force && sentArr.includes(day)) return json(200, { ok: true, skipped: "already_sent", day });
    if (!salon.email) return json(400, { error: "Salon sans email" });
    let prenom = String((salon as any).gerant_prenom || "").trim();
    if (!prenom) { try { const { data: cfg } = await sb.from("salons").select("config_json").eq("id", salon_id).maybeSingle(); const c = cfg?.config_json as any; if (c) prenom = String(c.gerantPrenom || c.prenom || c.contact_prenom || "").trim(); } catch {} }
    prenom = prenom.split(/\s+/)[0] || "";
    if (prenom) prenom = prenom.charAt(0).toUpperCase() + prenom.slice(1);
    const ctx: SalonCtx = { nom: salon.nom || "votre établissement", prenom, email: salon.email, slug: salon.slug || "", plan: (salon.plan || "essentiel").toLowerCase(), metier: String(salon.metier || "").toLowerCase(), mode: String((salon as any).mode_activite || "salon").toLowerCase() };
    const tpl = await buildEmail(day, ctx);
    if (!tpl) return json(400, { error: "Pas de template pour ce jour" });
    const res = await fetch(`${WORKER_BASE}/api/email/custom`, { method: "POST", headers: { "Content-Type": "application/json", "x-lx-internal": SB_SR }, body: JSON.stringify({ to: salon.email, toName: prenom || ctx.nom, salonName: "Alexandre de Luxyra", subject: tpl.subject, htmlContent: tpl.html, textContent: versionTexte(tpl.html) }) });
    const rTxt = await res.text();
    if (!res.ok) { await (globalThis as any).__lxReport?.("Brevo HTTP "+res.status+": "+rTxt.slice(0,200), "error", undefined, { salon_id, day }); return json(500, { error: "Email envoi échec" }); }
    const newSent = Array.from(new Set([...sentArr, day])).sort((a,b)=>a-b);
    await sb.from("salons").update({ onboarding_emails_sent: newSent }).eq("id", salon_id);
    return json(200, { ok: true, day, plan: ctx.plan });
  } catch (e) { console.error("salon-onboarding-email error", e); return json(500, { error: "Erreur interne" }); }
});
