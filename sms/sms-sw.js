// Service worker minimal pour rendre la PWA installable
// On ne met pas de cache agressif — cette app doit toujours parler à Supabase en temps réel
const VERSION = "luxyra-sms-v1";

self.addEventListener("install", e => {
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", e => {
  // Pas de cache — on laisse toujours passer au réseau
  // Ça garantit que l'app parle toujours au Supabase à jour
});
