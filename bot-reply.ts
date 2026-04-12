// supabase/functions/bot-reply/index.ts
// Deploy: supabase functions deploy bot-reply --no-verify-jwt
// Secrets requis: ANTHROPIC_API_KEY, SB_URL, SB_SERVICE_ROLE

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SB_URL = Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL")!;
const SB_SR  = Deno.env.get("SB_SERVICE_ROLE") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(SB_URL, SB_SR, { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM_PROMPT = `Tu es l'assistant support de Luxyra, un SaaS métier pour salons de coiffure, barbiers, estheticiennes, onglerie et bien-être (France).

Tu réponds aux questions techniques et fonctionnelles des professionnels utilisant Luxyra : caisse NF525, planning RDV, clients, encaissement, acomptes, cartes fidélité, cartes d'abonnement, site de réservation en ligne, stats, SMS, etc.

Règles :
- Réponses courtes (max 3-4 phrases), tutoies jamais, vouvoies toujours
- Si tu ne sais pas répondre avec certitude, ou si la demande concerne une action administrative (facture, remboursement, changement de forfait, bug complexe, données perdues, question juridique, plainte) : tu DOIS répondre UNIQUEMENT avec le token <ESCALATE/> (rien d'autre)
- Si la demande sort du périmètre Luxyra : réponds brièvement en recentrant sur le support Luxyra
- Ne jamais inventer une fonctionnalité qui n'existe pas. En cas de doute : <ESCALATE/>
- Forfaits : Essentiel 14.99€/mois, Pro 24.99€/mois
- Certification NF525 : Luxyra est conforme NF525 (hachage SHA-256, Z-clôture, bande Z mensuelle)
- Pour résilier ou gérer l'abonnement : renvoyer vers Paramètres > Forfait > "Gérer mon abonnement"
- Signe tes réponses naturellement sans "🤖" ni préfixe robotique, l'interface s'en charge`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { conversation_id, salon_id } = await req.json();
    if (!conversation_id || !salon_id) {
      return new Response(JSON.stringify({ error: "conversation_id & salon_id requis" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // Vérifier que la conv est bien bot_active
    const { data: conv } = await sb.from("support_conversations")
      .select("bot_active,status").eq("id", conversation_id).single();
    if (!conv || conv.bot_active === false) {
      return new Response(JSON.stringify({ skipped: "bot disabled" }),
        { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // Récupérer l'historique (max 20 derniers messages)
    const { data: msgs } = await sb.from("support_messages")
      .select("sender,message,created_at")
      .eq("conversation_id", conversation_id)
      .order("created_at", { ascending: true })
      .limit(20);

    if (!msgs || !msgs.length) {
      return new Response(JSON.stringify({ skipped: "no messages" }),
        { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // Convertir en format Anthropic messages
    const messages = msgs.map((m: any) => ({
      role: (m.sender === "client") ? "user" : "assistant",
      content: m.message || "",
    }));
    // Retirer les messages assistant consécutifs en fin (Anthropic exige alternance)
    while (messages.length && messages[messages.length - 1].role === "assistant") {
      messages.pop();
    }
    if (!messages.length) {
      return new Response(JSON.stringify({ skipped: "no user msg" }),
        { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // Appel Anthropic Claude Haiku 4.5
    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages,
      }),
    });

    if (!aiRes.ok) {
      const errTxt = await aiRes.text();
      console.error("Anthropic API error:", errTxt);
      // En cas d'erreur API → escalade silencieuse
      await sb.from("support_conversations").update({ bot_active: false }).eq("id", conversation_id);
      return new Response(JSON.stringify({ error: "api_failure_escalated" }),
        { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const aiData = await aiRes.json();
    const text = (aiData.content && aiData.content[0] && aiData.content[0].text) || "";

    // Escalade ?
    if (text.includes("<ESCALATE/>") || !text.trim()) {
      await sb.from("support_conversations").update({ bot_active: false }).eq("id", conversation_id);
      await sb.from("support_messages").insert({
        conversation_id,
        salon_id,
        sender: "bot",
        message: "🙋 Je transmets votre demande à un humain qui vous répondra rapidement.",
        read_by_admin: false,
        read_by_client: true,
      });
      // Déclencher notif push admin via un message admin fantôme (ou simple marker)
      // Ici on laisse le trigger trg_push_admin_reply se déclencher sur le prochain vrai admin reply.
      return new Response(JSON.stringify({ escalated: true }),
        { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // Réponse normale du bot (sender='bot' pour distinguer côté UI)
    await sb.from("support_messages").insert({
      conversation_id,
      salon_id,
      sender: "bot",
      message: text.trim(),
      read_by_admin: true,
      read_by_client: false,
    });

    return new Response(JSON.stringify({ replied: true, tokens: aiData.usage }),
      { headers: { ...CORS, "Content-Type": "application/json" } });

  } catch (e: any) {
    console.error("bot-reply error:", e);
    return new Response(JSON.stringify({ error: String(e?.message || e) }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
