# rdv-empreinte-release v7 (déployée le 31/10/2026, audit final I5)

Seul changement par rapport à la v6 déployée : la ligne
`if (String(user.email || "").toLowerCase() === "support@luxyra.fr") return true;`
est retirée de `_lxAutorise` : l'administration ne peut plus libérer l'empreinte bancaire d'un client
à la place de l'établissement. Restent autorisés : le propriétaire du salon et le rôle service.
Source complète : voir la fonction déployée (Supabase › Edge Functions › rdv-empreinte-release v7).
