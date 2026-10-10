// ============================================================================
// Luxyra — réception des sauvegardes de nuit dans Google Drive (Google Apps Script)
// À coller dans https://script.google.com (Nouveau projet), avec le compte Google qui doit
// recevoir les sauvegardes. Les fichiers arrivent dans le dossier Drive « Sauvegardes Luxyra ».
// Ils sont CHIFFRÉS (AES-256) : sans le mot de passe BACKUP_PASSPHRASE, ils sont illisibles.
// Les sauvegardes de plus de 60 jours sont mises à la corbeille automatiquement.
//
// Réglage obligatoire : Paramètres du projet (roue dentée) > Propriétés du script >
//   LUXYRA_SECRET = un long mot de passe (le même que le secret GitHub GDRIVE_SECRET)
// Puis : Déployer > Nouveau déploiement > Application Web
//   Exécuter en tant que : Moi — Qui a accès : Tout le monde  (le mot de passe protège l'accès)
// ============================================================================
const DOSSIER = "Sauvegardes Luxyra";
const GARDER_JOURS = 60;

function doPost(e) {
  const secret = PropertiesService.getScriptProperties().getProperty("LUXYRA_SECRET");
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return sortie({ ok: false, error: "json" }); }
  if (!secret || secret.length < 16 || body.secret !== secret) return sortie({ ok: false, error: "refuse" });
  const nom = String(body.nom || "");
  if (!/^luxyra-\d{4}-\d{2}-\d{2}\.dump\.gpg$/.test(nom)) return sortie({ ok: false, error: "nom" });
  const octets = Utilities.base64Decode(String(body.data || ""));
  if (!octets.length) return sortie({ ok: false, error: "vide" });
  const it = DriveApp.getFoldersByName(DOSSIER);
  const dossier = it.hasNext() ? it.next() : DriveApp.createFolder(DOSSIER);
  const anciens = dossier.getFilesByName(nom);
  while (anciens.hasNext()) anciens.next().setTrashed(true);   // même jour relancé : on remplace
  const f = dossier.createFile(Utilities.newBlob(octets, "application/octet-stream", nom));
  if (body.sha256) f.setDescription("SHA-256 : " + body.sha256);
  const limite = Date.now() - GARDER_JOURS * 86400000;
  const tous = dossier.getFiles(); let supprimes = 0;
  while (tous.hasNext()) {
    const x = tous.next();
    if (/^luxyra-\d{4}-\d{2}-\d{2}\.dump\.gpg$/.test(x.getName()) && x.getDateCreated().getTime() < limite) { x.setTrashed(true); supprimes++; }
  }
  return sortie({ ok: true, fichier: nom, taille: f.getSize(), supprimes: supprimes });
}

function sortie(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
