/* Luxyra — Attestation individuelle NF525 (art. 286, I, 3° bis du CGI)
 * Texte repris du MODÈLE OFFICIEL BOI-LETTRE-000242 du 25/03/2026 :
 *   volet 1 = éditeur (signé une fois par version majeure, depuis l'admin),
 *   volet 2 = établissement utilisateur (signé dans l'application ; sans lui l'attestation n'a pas de valeur).
 * Signature électronique simple (C. civ. art. 1366-1367, règlement eIDAS art. 25) : compte + ressaisie du mot de passe,
 * horodatage serveur, empreinte SHA-256 du texte signé, tables inaltérables (nf525_attestation_editeur / nf525_attestations).
 * ⚠ NE JAMAIS changer LX_ATT.versionMajeure sans faire signer une nouvelle attestation (nouvelle version majeure
 *   au sens du § 340 du BOI-TVA-DECLA-30-10-30). Les versions mineures 6.x.x restent couvertes.
 */
(function(){
  var LX_ATT = {
    versionLogiciel: "6.3.0",
    versionMajeure: "6",
    miseSurMarche: "2026-05-11",
    editeur: {
      representant: "Alexandre JENSEN",
      raison: "Alexandre JENSEN, entrepreneur individuel exerçant sous le nom commercial Luxyra",
      siret: "910 928 464 00023",
      adresse: "29 rue de l'Abbé Alexandre Pax, 57200 Sarreguemines",
      ville: "Sarreguemines"
    },
    logiciel: "Luxyra (logiciel de gestion et de caisse en mode SaaS pour les professionnels de la beauté, accessible sur https://luxyra.fr)",
    perimetre: "enregistrement des encaissements (tickets de caisse : prestations, produits, bons cadeaux, acomptes et paiements en ligne dès leur enregistrement dans la caisse), modes de règlement, annulations et avoirs, chaînage cryptographique SHA-256 des tickets, journal des événements, clôtures journalières, mensuelles et annuelles, archives signées, exports (FEC, archives JSON/CSV) et conservation des données pendant six ans.",
    horsPerimetre: "prise de rendez-vous et planning, fichier clients, communication (SMS, e-mails), site internet et réservation en ligne, gestion des stocks, devis, statistiques, ainsi que tout règlement qui ne serait pas enregistré dans la caisse Luxyra.",
    rappelPenal: "Il est rappelé que l'établissement d'une fausse attestation est un délit pénal passible de trois ans d'emprisonnement et de 45 000 € d'amende (code pénal, art. 441-1). L'usage d'une fausse attestation est passible des mêmes peines."
  };
  function dFr(d){ if(!d) return "…"; var x = (d instanceof Date) ? d : new Date(String(d).length===10 ? d+"T12:00:00" : d); return x.toLocaleDateString("fr-FR",{day:"2-digit",month:"2-digit",year:"numeric"}); }
  function hFr(d){ var x = new Date(d); return x.toLocaleDateString("fr-FR",{day:"2-digit",month:"2-digit",year:"numeric"})+" à "+x.toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"}); }
  function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c];}); }

  // Volet 1 — texte exact signé par l'éditeur (canonique : l'empreinte SHA-256 porte sur ce texte)
  function volet1(dateSignature){
    var e = LX_ATT.editeur;
    return "Je soussigné, " + e.representant + ", représentant légal de l'entreprise " + e.raison + " (SIRET " + e.siret + ", " + e.adresse + "), éditeur du logiciel de caisse " + LX_ATT.logiciel +
      ", atteste que les fonctionnalités de caisse de ce logiciel, mis sur le marché à compter du " + dFr(LX_ATT.miseSurMarche) + ", dans sa version n° " + LX_ATT.versionMajeure +
      ", satisfont aux conditions d'inaltérabilité, de sécurisation, de conservation et d'archivage des données en vue du contrôle de l'administration fiscale, prévues au 3° bis du I de l'article 286 du code général des impôts.\n\n" +
      "J'atteste que la dernière version majeure de ce logiciel est identifiée avec la racine suivante : " + LX_ATT.versionMajeure + " et que les versions mineures développées ultérieurement à cette version majeure sont ou seront identifiées par les subdivisions suivantes de cette racine : " + LX_ATT.versionMajeure + ".x.x. " +
      "Je m'engage à ce que ces subdivisions ne soient utilisées par " + e.representant + " (Luxyra) que pour l'identification des versions mineures ultérieures, à l'exclusion de toute version majeure. Les versions majeures et mineures du logiciel s'entendent au sens du III-A § 340 du BOI-TVA-DECLA-30-10-30.\n\n" +
      "Le périmètre couvert par cette attestation concerne les fonctionnalités suivantes : " + LX_ATT.perimetre + "\n\n" +
      "Les fonctionnalités suivantes ne sont pas couvertes par cette attestation : " + LX_ATT.horsPerimetre + "\n\n" +
      "Fait à " + e.ville + ", le " + dFr(dateSignature || new Date()) + ".\n\nRemarque : " + LX_ATT.rappelPenal;
  }
  // Volet 2 — d = {representant, qualite, etablissement, siret, dateAcquisition, dateDebut, ville, dateSignature}
  function volet2(d){
    return "Je soussigné(e), " + d.representant + ", " + d.qualite + " de " + d.etablissement + (d.siret ? " (SIRET " + d.siret + ")" : "") +
      ", certifie avoir acquis ou téléchargé le " + dFr(d.dateAcquisition) + ", auprès de " + LX_ATT.editeur.raison + ", le logiciel / système de caisse mentionné au volet 1 de cette attestation.\n\n" +
      "J'atteste utiliser ce logiciel / système de caisse pour enregistrer les règlements de mes clients particuliers, conformément à la réglementation fiscale en vigueur, depuis le " + dFr(d.dateDebut) + ".\n\n" +
      "Fait à " + d.ville + ", le " + dFr(d.dateSignature) + ".\n\nRemarque : " + LX_ATT.rappelPenal;
  }
  // Texte complet signé par l'établissement (contient l'empreinte du volet 1 signé par l'éditeur)
  function texteComplet(ed, d){
    return "ATTESTATION INDIVIDUELLE RELATIVE À L'UTILISATION D'UN LOGICIEL OU D'UN SYSTÈME DE CAISSE SÉCURISÉ (modèle BOI-LETTRE-000242)\n" +
      "Logiciel Luxyra — version " + LX_ATT.versionLogiciel + "\n\nVOLET 1 — ÉDITEUR\n" + ed.texte +
      "\n[Volet 1 signé électroniquement par " + ed.signataire + " le " + hFr(ed.signe_le) + " — empreinte SHA-256 : " + ed.texte_sha256 + "]\n\nVOLET 2 — ENTREPRISE UTILISATRICE\n" + volet2(d);
  }

  // Document imprimable (PDF via « Enregistrer au format PDF »). att = attestation signée, ou null pour une version papier à signer à la main.
  function imprimer(ed, att, d){
    var w = window.open("", "_blank", "width=820,height=1100"); if(!w) { alert("Autorisez l'ouverture des fenêtres pour imprimer l'attestation."); return; }
    var p = function(t){ return esc(t).split("\n\n").map(function(x){ return "<p>"+x.replace(/\n/g,"<br>")+"</p>"; }).join(""); };
    var v2 = att ? att : null;
    var dd = v2 ? { representant:v2.representant, qualite:v2.qualite, etablissement:v2.etablissement, siret:v2.siret, dateAcquisition:v2.date_acquisition, dateDebut:v2.date_debut_utilisation, ville:v2.ville_signature, dateSignature:v2.signe_le } : d;
    var h = '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Attestation de conformité de la caisse — ' + esc(dd.etablissement||"") + '</title><style>' +
      '@page{margin:16mm}body{font-family:Georgia,serif;max-width:760px;margin:20px auto;padding:0 20px;color:#1a1a1a;font-size:12.5px;line-height:1.6}' +
      'h1{font-size:16px;text-align:center;margin:0 0 4px;text-transform:uppercase;letter-spacing:.5px}.sub{text-align:center;color:#555;font-size:11px;margin-bottom:18px}' +
      'h2{font-size:13.5px;margin:22px 0 8px;padding:6px 10px;background:#f4efe2;border-left:4px solid #c8a84e}.note{font-size:11px;color:#444;border:1px solid #ddd;border-radius:6px;padding:10px;margin-top:10px}' +
      '.sig{margin-top:10px;padding:10px;border:1px dashed #999;border-radius:6px;font-size:11.5px}.sig b{color:#1a1a1a}.hash{font-family:monospace;font-size:10px;word-break:break-all;color:#555}' +
      'p{margin:0 0 10px;text-align:justify;-webkit-hyphens:auto;hyphens:auto}.sigrow{display:flex;gap:30px}.sigrow>div{flex:1}@media (max-width:640px){body{margin:0 auto;padding:12px 14px;font-size:14px;line-height:1.55}h1{font-size:15px;letter-spacing:0}.sub{font-size:11.5px}h2{font-size:14px;margin:18px 0 8px}p{text-align:left}.sig,.note{font-size:12.5px}.sigrow{flex-direction:column;gap:0}.btn{width:100%}}.blank{height:70px;border-bottom:1px solid #333;margin-top:30px}.btn{margin:20px auto;display:block;padding:10px 22px;font-size:14px;cursor:pointer}@media print{.btn{display:none}}</style></head><body>' +
      '<h1>Attestation individuelle relative à l’utilisation d’un logiciel ou d’un système de caisse sécurisé</h1>' +
      '<div class="sub">Article 286, I, 3° bis du code général des impôts — modèle officiel BOI-LETTRE-000242 (25/03/2026) — Logiciel Luxyra, version ' + esc(att ? att.version_logiciel : LX_ATT.versionLogiciel) + '</div>' +
      '<div class="note">Les volets 1 et 2 de cette attestation doivent être présentés à l’administration fiscale en cas de contrôle. Elle n’a de valeur que si son volet 2 est dûment complété et signé par l’entreprise utilisatrice du logiciel / système.</div>' +
      '<h2>Volet 1 : partie remplie par l’éditeur du logiciel de caisse</h2>' + p(ed.texte) +
      '<div class="sig">Signature du représentant légal de l’éditeur : <b>signé électroniquement par ' + esc(ed.signataire) + ' le ' + esc(hFr(ed.signe_le)) + '</b><br>Empreinte SHA-256 du volet 1 signé : <span class="hash">' + esc(ed.texte_sha256) + '</span></div>' +
      '<h2>Volet 2 : partie remplie par l’entreprise qui utilise le logiciel de caisse</h2>' + p(volet2(dd));
    if (att) {
      h += '<div class="sig">Signature du représentant légal : <b>signé électroniquement par ' + esc(att.representant) + ' le ' + esc(hFr(att.signe_le)) + '</b><br>' +
        'Procédé : ' + esc(att.methode) + '. Référence n° ' + esc(att.id) + '.<br>Empreinte SHA-256 du document signé (volets 1 et 2) : <span class="hash">' + esc(att.texte_sha256) + '</span></div>';
    } else {
      h += '<div class="sigrow"><div>Signature du représentant légal :<div class="blank"></div></div><div>Cachet de l’entreprise :<div class="blank"></div></div></div>';
    }
    h += '<div class="note">Conservez ce document avec vos pièces comptables pendant toute la durée d’utilisation du logiciel puis six ans (art. L102 B du livre des procédures fiscales). ' +
      'Une nouvelle attestation vous sera demandée à chaque nouvelle version majeure du logiciel.</div>' +
      '<button class="btn" onclick="window.print()">Imprimer / enregistrer en PDF</button></body></html>';
    w.document.open(); w.document.write(h); w.document.close();
  }
  window.LX_ATT = LX_ATT;
  window.lxAtt = { volet1: volet1, volet2: volet2, texteComplet: texteComplet, imprimer: imprimer, dFr: dFr, hFr: hFr, esc: esc };
})();
